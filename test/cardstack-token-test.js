const {
  GAS_PRICE,
  MAX_FAILED_TXN_GAS,
  ROUNDING_ERROR_WEI,
  NULL_ADDRESS,
  CST_DEPLOY_GAS_LIMIT,
  CARDSTACK_NAMEHASH,
  asInt,
  assertRevert,
  checkBalance
} = require("../lib/utils");

const Registry = artifacts.require("./Registry.sol");
const CardStackToken = artifacts.require("./CardStackToken.sol");
const CstLedger = artifacts.require("./CstLedger.sol");
const Storage = artifacts.require("./ExternalStorage.sol");

contract('CardStackToken', function(accounts) {
  let ledger;
  let storage;
  let registry;
  let cst;
  let superAdmin = accounts[42];

  describe("create contract", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      await storage.setBytes32Value("cstTokenName", web3.toHex("CardStack Token"));
      await storage.setBytes32Value("cstTokenSymbol", web3.toHex("CST"));
      await storage.setUIntValue("cstBuyPrice", web3.toWei(0.1, "ether"));
      await storage.setUIntValue("cstCirculationCap", 100);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });

      let isRegistrySuperAdmin = await cst.superAdmins(registry.address);
      let superAdminCount = await cst.totalSuperAdminsMapping();
      let firstSuperAdmin = await cst.superAdminsForIndex(0);

      assert.ok(isRegistrySuperAdmin, "the registry is the super admin for the cst contract");
      assert.equal(superAdminCount, 1, "the super admin count is correct for the cst contract");
      assert.equal(firstSuperAdmin, registry.address, "the super admin by index is correct for the cst contract");

      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    // be kind and return ethers to the root account
    afterEach(async function() {
      let cstEth = await web3.eth.getBalance(cst.address);

      await cst.freezeToken(true);
      await cst.configure(0x0, 0x0, 0, 0, 1000000, accounts[0]);
      await cst.foundationWithdraw(cstEth.toNumber());
    });

    it("should configure the CST correctly", async function() {
      await ledger.mintTokens(10000);

      await cst.freezeToken(true); // triggers a price change so need to freeze token first
      let txn = await cst.configure(web3.toHex("CardStack Token"), web3.toHex("CST"), 2, 8000, 1000000, NULL_ADDRESS);

      let name = await cst.name();
      let symbol = await cst.symbol();
      let totalTokens = await cst.totalSupply();
      let buyPrice = await cst.buyPrice();
      let circulationCap = await cst.circulationCap();
      let balanceLimit = await cst.cstBalanceLimit();
      let totalInCirculation = await cst.totalInCirculation();

      assert.equal(name, "CardStack Token", "The name of the token is correct");
      assert.equal(symbol, "CST", "The symbol of the token is correct");
      assert.equal(asInt(totalTokens), 10000, "The totalTokens is correct");
      assert.equal(asInt(circulationCap), 8000, "The circulationCap is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
      assert.equal(asInt(buyPrice), 2, "The buyPrice is correct");
      assert.equal(asInt(balanceLimit), 1000000, "The balanceLimit is correct");

      let storageTokenName = await storage.getBytes32Value("cstTokenName");
      let storageTokenSymbol = await storage.getBytes32Value("cstTokenSymbol");
      let storageBuyPrice = await storage.getUIntValue("cstBuyPrice");
      let storageCirculationCap = await storage.getUIntValue("cstCirculationCap");

      assert.equal(web3.toUtf8(storageTokenName.toString()), "CardStack Token", "external storage is updated");
      assert.equal(web3.toUtf8(storageTokenSymbol.toString()), "CST", "external storage is updated");
      assert.equal(storageBuyPrice.toNumber(), 2, "external storage is updated");
      assert.equal(storageCirculationCap.toNumber(), 8000, "external storage is updated");

      // console.log(JSON.stringify(txn, null, 2));
      assert.equal(txn.logs.length, 1, "the correct number of events were fired");
      let event = txn.logs[0];
      assert.equal(event.event, "ConfigChanged", "the event name is correct");
      assert.equal(event.args.buyPrice.toNumber(), 2, "the buyPrice is correct");
      assert.equal(event.args.circulationCap.toNumber(), 8000, "the circulationCap is correct");
      assert.equal(event.args.balanceLimit.toNumber(), 1000000, "the balanceLimit is correct");
    });

    it("allows the CST price to be changed when the token is frozen", async function() {
      await ledger.mintTokens(10000);
      await cst.freezeToken(true);

      await cst.configure(web3.toHex("CardStack Token"), web3.toHex("CST"), 5, 8000, 1000000, NULL_ADDRESS);

      let buyPrice = await cst.buyPrice();
      assert.equal(buyPrice.toNumber(), 5, "the buyPrice is correct");
    });

    it("does not allow the CST price to be changed when the token is not frozen", async function() {
      await ledger.mintTokens(10000);
      await assertRevert(async () => await cst.configure(web3.toHex("CardStack Token"), web3.toHex("CST"), 5, 8000, 1000000, NULL_ADDRESS));

      let buyPrice = await cst.buyPrice();
      assert.equal(buyPrice.toNumber(), web3.toWei(0.1, "ether"), "the buyPrice is correct");
    });

    it("non-owner cannot configure token", async function() {
      let nonOwner = accounts[1];

      await ledger.mintTokens(10000);
      await cst.freezeToken(true); // triggers a price change so need to freeze token first

      await assertRevert(async () => await cst.configure(web3.toHex("CardStack Token"), web3.toHex("CST"), 2, 8000, 1000000, NULL_ADDRESS, {
        from: nonOwner
      }));
    });

    it("does not allow non-superAdmin to configure using external storage", async function() {
      let nonOwner = accounts[1];

      await ledger.mintTokens(10000);
      await cst.freezeToken(true); // triggers a price change so need to freeze token first

      await storage.setUIntValue(web3.sha3("cstBuyPrice"), web3.toWei(0.5, "ether"));
      await storage.setUIntValue(web3.sha3("cstCirculationCap"), 10);
      await storage.setBytes32Value(web3.sha3("cstTokenSymbol"), web3.toHex("CST1"));
      await storage.setBytes32Value(web3.sha3("cstTokenName"), web3.toHex("New CardStack Token"));

      await assertRevert(async () => await cst.configureFromStorage({ from: nonOwner }));
    });

    it("can allow superAdmin to update storage", async function() {
      let tokenHolder = accounts[6];
      let newStorage = await Storage.new();
      let newLedger = await CstLedger.new();

      await ledger.mintTokens(10000);
      await cst.freezeToken(true); // triggers a price change so need to freeze token first

      await newStorage.setUIntValue("cstBuyPrice", web3.toWei(0.5, "ether"));
      await newStorage.setUIntValue("cstCirculationCap", 10);
      await newStorage.setBytes32Value("cstTokenSymbol", web3.toHex("CST1"));
      await newStorage.setBytes32Value("cstTokenName", web3.toHex("New CardStack Token"));
      await newLedger.mintTokens(200);
      await newLedger.debitAccount(tokenHolder, 100);

      await registry.addStorage("newStorage", newStorage.address);
      await registry.addStorage("newLedger", newLedger.address);
      await newStorage.addSuperAdmin(registry.address);
      await newLedger.addSuperAdmin(registry.address);
      await newStorage.addAdmin(cst.address);
      await newLedger.addAdmin(cst.address);

      await cst.updateStorage("newStorage", "newLedger", { from: superAdmin });

      let name = await cst.name();
      let symbol = await cst.symbol();
      let buyPrice = await cst.buyPrice();
      let circulationCap = await cst.circulationCap();
      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let balance = await cst.balanceOf(tokenHolder);

      assert.equal(name, "New CardStack Token", "The name of the token is correct");
      assert.equal(symbol, "CST1", "The symbol of the token is correct");
      assert.equal(asInt(circulationCap), 10, "The circulationCap is correct");
      assert.equal(asInt(buyPrice), web3.toWei(0.5, "ether"), "The buyPrice is correct");
      assert.equal(asInt(totalTokens), 200, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 100, "The totalInCirculation is correct");
      assert.equal(asInt(balance), 100, "The balance is correct");
    });

    it("cannot update storage when token is not frozen", async function() {
      let tokenHolder = accounts[6];
      let newStorage = await Storage.new();
      let newLedger = await CstLedger.new();

      await ledger.mintTokens(10000);

      await newStorage.setUIntValue("cstBuyPrice", web3.toWei(0.5, "ether"));
      await newStorage.setUIntValue("cstCirculationCap", 10);
      await newStorage.setBytes32Value("cstTokenSymbol", web3.toHex("CST1"));
      await newStorage.setBytes32Value("cstTokenName", web3.toHex("New CardStack Token"));
      await newLedger.mintTokens(200);
      await newLedger.debitAccount(tokenHolder, 100);

      await registry.addStorage("newStorage", newStorage.address);
      await registry.addStorage("newLedger", newLedger.address);
      await newStorage.addSuperAdmin(registry.address);
      await newLedger.addSuperAdmin(registry.address);
      await newStorage.addAdmin(cst.address);
      await newLedger.addAdmin(cst.address);

      await cst.freezeToken(false);
      await assertRevert(async () => await cst.updateStorage("newStorage", "newLedger", { from: superAdmin }));

      let name = await cst.name();
      let symbol = await cst.symbol();
      let buyPrice = await cst.buyPrice();
      let circulationCap = await cst.circulationCap();
      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let balance = await cst.balanceOf(tokenHolder);

      assert.equal(name, "CardStack Token", "The name of the token is correct");
      assert.equal(symbol, "CST", "The symbol of the token is correct");
      assert.equal(asInt(circulationCap), 100, "The circulationCap is correct");
      assert.equal(asInt(buyPrice), web3.toWei(0.1, 'ether'), "The buyPrice is correct");

      assert.equal(asInt(totalTokens), 10000, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
      assert.equal(asInt(balance), 0, "The balance is correct");
    });

    it("non-superAdmin cannot not update storage", async function() {
      let nonOwner = accounts[9];
      let tokenHolder = accounts[6];

      let newStorage = await Storage.new();
      let newLedger = await CstLedger.new();

      await ledger.mintTokens(10000);
      await cst.freezeToken(true); // triggers a price change so need to freeze token first

      await newStorage.setUIntValue("cstBuyPrice", web3.toWei(0.5, "ether"));
      await newStorage.setUIntValue("cstCirculationCap", 10);
      await newStorage.setBytes32Value("cstTokenSymbol", web3.toHex("CST1"));
      await newStorage.setBytes32Value("cstTokenName", web3.toHex("New CardStack Token"));
      await newLedger.mintTokens(200);
      await newLedger.debitAccount(tokenHolder, 100);

      await registry.addStorage("newStorage", newStorage.address);
      await registry.addStorage("newLedger", newLedger.address);
      await newStorage.addSuperAdmin(registry.address);
      await newLedger.addSuperAdmin(registry.address);
      await newStorage.addAdmin(cst.address);
      await newLedger.addAdmin(cst.address);

      await assertRevert(async () => await cst.updateStorage("newStorage", "newLedger", { from: nonOwner }));

      let name = await cst.name();
      let symbol = await cst.symbol();
      let buyPrice = await cst.buyPrice();
      let circulationCap = await cst.circulationCap();
      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let balance = await cst.balanceOf(tokenHolder);

      assert.equal(name, "CardStack Token", "The name of the token is correct");
      assert.equal(symbol, "CST", "The symbol of the token is correct");
      assert.equal(asInt(circulationCap), 100, "The circulationCap is correct");
      assert.equal(asInt(buyPrice), web3.toWei(0.1, 'ether'), "The buyPrice is correct");

      assert.equal(asInt(totalTokens), 10000, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
      assert.equal(asInt(balance), 0, "The balance is correct");
    });

    it("allows a superAdmin to add a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      let txn = await cst.addSuperAdmin(anotherSuperAdmin, { from: superAdmin });

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, true, 'super admin was created');

      assert.ok(txn.logs);
      let event = txn.logs[0];
      assert.equal(event.event, "AddSuperAdmin", "The event type is correct");
      assert.equal(event.args.admin, anotherSuperAdmin, "The super admin address is correct");
    });

    it("allows a superAdmin to remove a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      await cst.addSuperAdmin(anotherSuperAdmin);

      let txn = await cst.removeSuperAdmin(anotherSuperAdmin, { from: superAdmin });

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, false, 'super admin was removed');

      assert.ok(txn.logs);
      let event = txn.logs[0];
      assert.equal(event.event, "RemoveSuperAdmin", "The event type is correct");
      assert.equal(event.args.admin, anotherSuperAdmin, "The super admin address is correct");
    });

    it("does not allow an admin to add a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      let admin = accounts[14];
      await cst.addAdmin(admin);

      await assertRevert(async () => await cst.addSuperAdmin(anotherSuperAdmin, { from: admin }));

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, false, 'super admin was not created');
    });

    it("does not allow an admin to remove a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      let admin = accounts[14];
      await cst.addAdmin(admin);
      await cst.addSuperAdmin(anotherSuperAdmin);

      await assertRevert(async () => await cst.removeSuperAdmin(anotherSuperAdmin, { from: admin }));

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, true, 'super admin was not removed');
    });

    it("does not allow a-non superAdmin to add a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      let person = accounts[14];

      await assertRevert(async () => await cst.addSuperAdmin(anotherSuperAdmin, { from: person }));

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, false, 'super admin was not created');
    });

    it("does not allow a-non superAdmin to remove a superAdmin", async function() {
      let anotherSuperAdmin = accounts[13];
      let person = accounts[14];
      await cst.addSuperAdmin(anotherSuperAdmin);

      await assertRevert(async () => await cst.removeSuperAdmin(anotherSuperAdmin, { from: person }));

      let isSuperAdmin = await cst.superAdmins(anotherSuperAdmin);
      assert.equal(isSuperAdmin, true, 'super admin was not removed');
    });
  });

  describe("setHaltPurchase()", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    it("allows a super admin to setHaltPurchase(true)", async function() {
      let txn = await cst.setHaltPurchase(true, { from: superAdmin });
      let isHalted = await cst.haltPurchase();

      assert.equal(isHalted, true, 'haltPurchase is correct');
      assert.ok(txn.logs);

      let event = txn.logs[0];
      assert.equal(event.event, "PurchaseHalted", "The event type is correct");
    });

    it("allows a super admin to setHaltPurchase(false)", async function() {
      await cst.setHaltPurchase(true);
      let txn = await cst.setHaltPurchase(false, { from: superAdmin });
      let isHalted = await cst.haltPurchase();

      assert.equal(isHalted, false, 'haltPurchase is correct');
      assert.ok(txn.logs);

      let event = txn.logs[0];
      assert.equal(event.event, "PurchaseResumed", "The event type is correct");
    });

    it("does not allow a non-super admin to setHaltPurchase()", async function() {
      let person = accounts[32];
      await assertRevert(async () => await cst.setHaltPurchase(true, { from: person }));

      let isHalted = await cst.haltPurchase();

      assert.equal(isHalted, false, 'haltPurchase is correct');
    });
  });

  describe("mintTokens()", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    it("can allow the superAdmin to mint tokens", async function() {
      await ledger.mintTokens(100);

      let txn = await cst.mintTokens(100, {
        from: superAdmin
      });

      // console.log("TXN", JSON.stringify(txn, null, 2));
      assert.ok(txn.receipt);
      assert.ok(txn.logs);

      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let balanceOfCstContract = await cst.balanceOf(cst.address);

      assert.equal(asInt(totalTokens), 200, "The totalTokens is correct");
      assert.equal(asInt(balanceOfCstContract), 200, "The balanceOf cst contract is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");

      assert.equal(txn.logs.length, 2, "The correct number of events were fired");

      let event = txn.logs[0];
      assert.equal(event.event, "Mint", "The event type is correct");
      assert.equal(asInt(event.args.amountMinted), 100, "The amount minted is correct");
      assert.equal(asInt(event.args.totalTokens), 200, "The total tokens is correct");

      event = txn.logs[1];
      assert.equal(event.event, "Transfer", "The event type is correct");
      assert.equal(asInt(event.args._value), 100, "The amount minted is correct");
      assert.equal(event.args._from, NULL_ADDRESS, "The from address is correct");
      assert.equal(event.args._to, cst.address, "The to address is correct");
    });

    it("does not allow a non-owner to mint tokens", async function() {
      await ledger.mintTokens(100);
      let nonOwnerAccount = accounts[9];

      await assertRevert(async () => await cst.mintTokens(100, {
        from: nonOwnerAccount
      }));

      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();

      assert.equal(asInt(totalTokens), 100, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
    });
  });

  describe("grantTokens()", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    it("can allow the superAdmin to grant tokens", async function() {
      await ledger.mintTokens(100);
      let recipientAccount = accounts[9];

      let txn = await cst.grantTokens(recipientAccount, 20, {
        from: superAdmin
      });

      // console.log("TXN", JSON.stringify(txn, null, 2));
      assert.ok(txn.receipt);
      assert.ok(txn.logs);

      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let recipientBalance = await cst.balanceOf(recipientAccount);
      let balanceOfCstContract = await cst.balanceOf(cst.address);

      assert.equal(asInt(totalTokens), 100, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 20, "The totalInCirculation is correct");
      assert.equal(asInt(recipientBalance), 20, "The recipientBalance is correct");
      assert.equal(asInt(balanceOfCstContract), 80, "The balanceOf the cst contract is correct");

      assert.equal(txn.logs.length, 1, "The correct number of events were fired");

      let event = txn.logs[0];
      assert.equal(event.event, "Transfer", "The event type is correct");
      assert.equal(event.args._value, 20, "The CST amount is correct");
      assert.equal(event.args._from, cst.address, "The sender is correct");
      assert.equal(event.args._to, recipientAccount, "The recipient is correct");
    });

    it("cannot grant more tokens than exist", async function() {
      await ledger.mintTokens(100);
      let recipientAccount = accounts[9];

      await assertRevert(async () => await cst.grantTokens(recipientAccount, 101, {
        from: superAdmin
      }));

      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let recipientBalance = await cst.balanceOf(recipientAccount);

      assert.equal(asInt(totalTokens), 100, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
      assert.equal(asInt(recipientBalance), 0, "The recipientBalance is correct");
    });

    it("does not allow a non-superAdmin to grant tokens", async function() {
      await ledger.mintTokens(100);
      let recipientAccount = accounts[9];

      await assertRevert(async () => await cst.grantTokens(recipientAccount, 10, {
        from: recipientAccount
      }));

      let totalTokens = await cst.totalSupply();
      let totalInCirculation = await cst.totalInCirculation();
      let recipientBalance = await cst.balanceOf(recipientAccount);

      assert.equal(asInt(totalTokens), 100, "The totalTokens is correct");
      assert.equal(asInt(totalInCirculation), 0, "The totalInCirculation is correct");
      assert.equal(asInt(recipientBalance), 0, "The recipientBalance is correct");
    });
  });

  describe("foundation", function() {
    let foundation = accounts[11];

    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      await storage.setBytes32Value("cstTokenName", web3.toHex("CardStack Token"));
      await storage.setBytes32Value("cstTokenSymbol", web3.toHex("CST"));
      await storage.setUIntValue("cstBuyPrice", 10);
      await storage.setUIntValue("cstCirculationCap", web3.toWei(1000));
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
      await cst.mintTokens(web3.toWei(1000, 'ether'));
    });

    // be kind and return ethers to the root account
    afterEach(async function() {
      let cstEth = await web3.eth.getBalance(cst.address);

      await cst.freezeToken(true);
      await cst.configure(0x0, 0x0, 0, 0, 1000000, accounts[0]);
      await cst.foundationWithdraw(cstEth.toNumber());
    });

    it("allows foundation to withdraw ether from foundationWithdraw()", async function() {
      let buyer = accounts[20];
      await checkBalance(buyer, 1);
      await cst.configure(0x0, 0x0, 10, web3.toWei(1000, 'ether'), web3.toWei(1000000, 'ether'), foundation, { from: superAdmin });

      let txnValue = web3.toWei(1, "ether");
      await cst.addBuyer(buyer);
      await cst.buy({
        from: buyer,
        value: txnValue,
        gasPrice: GAS_PRICE
      });

      let startFoundationBalance = await web3.eth.getBalance(foundation);
      startFoundationBalance = asInt(startFoundationBalance);

      let txn = await cst.foundationWithdraw(txnValue, {
        from: foundation,
        gasPrice: GAS_PRICE
      });

      // console.log("TXN", JSON.stringify(txn, null, 2));

      let { cumulativeGasUsed } = txn.receipt;
      let endCstBalance = await web3.eth.getBalance(cst.address);
      let endFoundationBalance = await web3.eth.getBalance(foundation);
      endCstBalance = asInt(endCstBalance);
      endFoundationBalance = asInt(endFoundationBalance);

      // doing math in ethers to prevent overflow errors
      let finalBalance = parseFloat(web3.fromWei(startFoundationBalance, "ether"))
                       + parseFloat(web3.fromWei(txnValue, "ether"))
                       - parseFloat(web3.fromWei(GAS_PRICE * cumulativeGasUsed, "ether"))
                       - parseFloat(web3.fromWei(endFoundationBalance, "ether"));

      assert.ok(cumulativeGasUsed < 40000, "Less than 40000 gas was used for the txn");
      assert.ok(Math.abs(finalBalance) < parseFloat(web3.fromWei(ROUNDING_ERROR_WEI, "ether")), "Foundations's wallet balance was changed correctly");
      assert.equal(endCstBalance, 0, "The CST balance is correct");
    });

    it("does not allow non-foundation to withdraw ether from foundationWithdraw()", async function() {
      let buyer = accounts[20];
      let nonFoundation = accounts[21];
      await checkBalance(buyer, 1);
      await cst.configure(0x0, 0x0, 10, web3.toWei(1000, 'ether'), web3.toWei(1000000, 'ether'), foundation, { from: superAdmin });

      let txnValue = web3.toWei(1, "ether");
      await cst.addBuyer(buyer);
      await cst.buy({
        from: buyer,
        value: txnValue,
        gasPrice: GAS_PRICE
      });

      let startNonFoundationBalance = await web3.eth.getBalance(nonFoundation);
      startNonFoundationBalance = asInt(startNonFoundationBalance);

      await assertRevert(async () => await cst.foundationWithdraw(txnValue, {
        from: nonFoundation,
        gasPrice: GAS_PRICE
      }));

      let endCstBalance = await web3.eth.getBalance(cst.address);
      let endNonFoundationBalance = await web3.eth.getBalance(nonFoundation);
      endCstBalance = asInt(endCstBalance);
      endNonFoundationBalance = asInt(endNonFoundationBalance);

      assert.ok(startNonFoundationBalance - endNonFoundationBalance < MAX_FAILED_TXN_GAS * GAS_PRICE, "The non foundation account was changed for just gas");
      assert.equal(endCstBalance, txnValue, "The CST balance is correct");
    });

    it("allows foundation to deposit ether in foundationDeposit", async function() {
      await cst.configure(0x0, 0x0, 10, web3.toWei(1000, 'ether'), web3.toWei(1000000, 'ether'), foundation, { from: superAdmin });

      let txnValue = web3.toWei(1, "ether");
      let startFoundationBalance = await web3.eth.getBalance(foundation);
      startFoundationBalance = asInt(startFoundationBalance);

      let txn = await cst.foundationDeposit({
        from: foundation,
        value: txnValue,
        gasPrice: GAS_PRICE
      });

      let { cumulativeGasUsed } = txn.receipt;
      let endCstBalance = await web3.eth.getBalance(cst.address);
      let endFoundationBalance = await web3.eth.getBalance(foundation);
      endCstBalance = asInt(endCstBalance);
      endFoundationBalance = asInt(endFoundationBalance);

      // doing math in ethers to prevent overflow errors
      let finalBalance = parseFloat(web3.fromWei(startFoundationBalance, "ether"))
                       - parseFloat(web3.fromWei(GAS_PRICE * cumulativeGasUsed, "ether"))
                       - parseFloat(web3.fromWei(txnValue, "ether"))
                       - parseFloat(web3.fromWei(endFoundationBalance, "ether"));

      assert.ok(cumulativeGasUsed < 40000, "Less than 40000 gas was used for the txn");
      assert.ok(Math.abs(finalBalance) < parseFloat(web3.fromWei(ROUNDING_ERROR_WEI, "ether")), "Foundations's wallet balance was changed correctly");
      assert.equal(endCstBalance, txnValue, "The CST balance is correct");
    });
  });

  describe("buyer whitelist", function() {
    let approvedBuyer = accounts[11];

    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      await storage.setBytes32Value("cstTokenName", web3.toHex("CardStack Token"));
      await storage.setBytes32Value("cstTokenSymbol", web3.toHex("CST"));
      await storage.setUIntValue("cstBuyPrice", web3.toWei(0.1, "ether"));
      await storage.setUIntValue("cstCirculationCap", 1000);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.configure(0x0, 0x0, web3.toWei(0.1, "ether"), 1000, 1000000, 0x0);
      await cst.addSuperAdmin(superAdmin);
      await cst.mintTokens(1000);
    });

    it("allows a super admin to add an approved buyer", async function() {
      let totalBuyers = await cst.totalBuyersMapping();

      assert.equal(totalBuyers.toNumber(), 0, 'the totalBuyers is correct');

      let txn = await cst.addBuyer(approvedBuyer, { from: superAdmin });

      totalBuyers = await cst.totalBuyersMapping();
      let isBuyer = await cst.approvedBuyer(approvedBuyer);
      let firstBuyer = await cst.approvedBuyerForIndex(0);

      assert.equal(totalBuyers, 1, 'the totalBuyersMapping is correct');
      assert.ok(isBuyer, "the buyer is set");
      assert.equal(firstBuyer, approvedBuyer, "the approvedBuyerForIndex is correct");

      assert.equal(txn.logs.length, 1, 'the number of events fired is correct');
      let event = txn.logs[0];

      assert.equal(event.event, "WhiteList", "the event type is correct");
      assert.equal(event.args.buyer, approvedBuyer, "the whitelist address is correct");
      assert.equal(event.args.holdCap, 1000000, "the hold cap is correct");
    });

    it("allows a super admin to remove an approved buyer", async function() {
      await cst.addBuyer(approvedBuyer, { from: superAdmin });

      await cst.removeBuyer(approvedBuyer, { from: superAdmin });

      let isBuyer = await cst.approvedBuyer(approvedBuyer);

      assert.notOk(isBuyer, "the buyer is not set");
    });

    it("does not allow a non-super admin to add an approved buyer", async function() {
      await assertRevert(async () => await cst.addBuyer(approvedBuyer, { from: approvedBuyer }));

      let totalBuyers = await cst.totalBuyersMapping();
      let isBuyer = await cst.approvedBuyer(approvedBuyer);

      assert.equal(totalBuyers.toNumber(), 0, 'the totalBuyersMapping is correct');
      assert.notOk(isBuyer, "the buyer is not set");
    });

    it("does not allow a non-super admin to remove an approved buyer", async function() {
      await cst.addBuyer(approvedBuyer, { from: superAdmin });

      await assertRevert(async () => await cst.removeBuyer(approvedBuyer, { from: approvedBuyer }));

      let totalBuyers = await cst.totalBuyersMapping();
      let isBuyer = await cst.approvedBuyer(approvedBuyer);

      assert.equal(totalBuyers, 1, 'the totalBuyersMapping is correct');
      assert.ok(isBuyer, "the buyer is set");
    });

  });

  describe("setContributionMinimum", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    it("allows super admin to call setContributionMinimum", async function() {
      let contributionMinimum = await cst.contributionMinimum();
      assert.equal(contributionMinimum.toNumber(), 0, "The contributionMinimum is initially 0");

      await cst.setContributionMinimum(10, { from: superAdmin });

      contributionMinimum = await cst.contributionMinimum();
      assert.equal(contributionMinimum.toNumber(), 10, "The contributionMinimum is correct");
    });

    it("does not allow non-super admin to call setContributionMinimum", async function() {
      let nonSuperAdmin = accounts[33];

      await assertRevert(async () => await cst.setContributionMinimum(10, { from: nonSuperAdmin }));

      let contributionMinimum = await cst.contributionMinimum();
      assert.equal(contributionMinimum.toNumber(), 0, "The contributionMinimum is correct");
    });
  });

  describe("setAllowTransfers", function() {
    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.addSuperAdmin(superAdmin);
    });

    it("allows super admin to call setAllowTransfers", async function() {
      let allowTransfers = await cst.allowTransfers();

      assert.notOk(allowTransfers, "transfers are not initially allowed");

      await cst.setAllowTransfers(true, { from: superAdmin });
      allowTransfers = await cst.allowTransfers();

      assert.ok(allowTransfers, "super admin setAllowedTransfers to true");
    });

    it("does not allow non-super admin to call setAllowTransfers", async function() {
      let nonSuperAdmin = accounts[33];

      await assertRevert(async () => await cst.setAllowTransfers(true, { from: nonSuperAdmin }));

      let allowTransfers = await cst.allowTransfers();
      assert.notOk(allowTransfers, "setAllowTransfers is not changed by non-super admin");
    });
  });

  describe("setCustomBuyer", function() {
    let customBuyer = accounts[23];
    let approvedBuyer = accounts[17];

    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.configure(0x0, 0x0, web3.toWei(0.1, "ether"), 1000, 1000000, 0x0);
      await cst.addSuperAdmin(superAdmin);
    });

    it("should allows super admin to set custom buyer", async function() {
      let totalCustomBuyers = await cst.totalCustomBuyersMapping();

      assert.equal(totalCustomBuyers, 0, 'the total custom buyers is correct');

      let txn = await cst.setCustomBuyer(customBuyer, 30000, { from: superAdmin });

      totalCustomBuyers = await cst.totalCustomBuyersMapping();
      let totalBuyers = await cst.totalBuyersMapping();
      let customBuyerLimit = await cst.customBuyerLimit(customBuyer);
      let isBuyer = await cst.approvedBuyer(customBuyer);
      let firstCustomBuyer = await cst.customBuyerForIndex(0);

      assert.equal(totalBuyers, 1, 'the total buyers is correct');
      assert.equal(totalCustomBuyers, 1, 'the total custom buyers is correct');
      assert.equal(customBuyerLimit, 30000, 'the custom buyer limit is correct');
      assert.ok(isBuyer, "the buyer is set");
      assert.equal(firstCustomBuyer, customBuyer, "the customBuyerForIndex is correct");

      assert.equal(txn.logs.length, 1, 'the number of events fired is correct');
      let event = txn.logs[0];

      assert.equal(event.event, "WhiteList", "the event type is correct");
      assert.equal(event.args.buyer, customBuyer, "the whitelist address is correct");
      assert.equal(event.args.holdCap, 30000, "the hold cap is correct");
    });

    it("should not allow non-super admin to set custom buyer", async function() {
      await assertRevert(async () => await cst.setCustomBuyer(approvedBuyer, 30000, { from: approvedBuyer }));

      let totalCustomBuyers = await cst.totalCustomBuyersMapping();
      let isBuyer = await cst.approvedBuyer(approvedBuyer);

      assert.equal(totalCustomBuyers.toNumber(), 0, 'the totalCustomBuyers is correct');
      assert.notOk(isBuyer, "the buyer is not set");
    });
  });

  describe("setWhitelistedTransferer", function() {
    let whitelistedTransferer = accounts[10];

    beforeEach(async function() {
      ledger = await CstLedger.new();
      storage = await Storage.new();
      registry = await Registry.new();
      await registry.addStorage("cstStorage", storage.address);
      await registry.addStorage("cstLedger", ledger.address);
      await storage.addSuperAdmin(registry.address);
      await ledger.addSuperAdmin(registry.address);
      cst = await CardStackToken.new(registry.address, "cstStorage", "cstLedger", {
        gas: CST_DEPLOY_GAS_LIMIT
      });
      await registry.register("CST", cst.address, CARDSTACK_NAMEHASH);
      await cst.freezeToken(false);
      await cst.configure(0x0, 0x0, web3.toWei(0.1, "ether"), 1000, 1000000, 0x0);
      await cst.addSuperAdmin(superAdmin);
    });

    it("should allow super admin to set whitelisted transferer", async function() {
      let totalWhitelistedTransferers = await cst.totalTransferWhitelistMapping();

      assert.equal(totalWhitelistedTransferers, 0, 'the total whitelisted transferers is correct');

      await cst.setWhitelistedTransferer(whitelistedTransferer, true, { from: superAdmin });

      totalWhitelistedTransferers = await cst.totalTransferWhitelistMapping();
      let isWhitelistedTransferer = await cst.whitelistedTransferer(whitelistedTransferer);
      let firstWhitelistedTransferer = await cst.whitelistedTransfererForIndex(0);

      assert.equal(totalWhitelistedTransferers, 1, 'the total whitelisted transferers is correct');
      assert.ok(isWhitelistedTransferer, "the whitelisted transferer is set");
      assert.equal(firstWhitelistedTransferer, whitelistedTransferer, "the whitelistedTransfererForIndex is correct");
    });

    it("should not allow non-super admin to set whitelisted transferer", async function() {
      await assertRevert(async () => await cst.setWhitelistedTransferer(whitelistedTransferer, true, { from: whitelistedTransferer }));

      let totalWhitelistedTransferers = await cst.totalTransferWhitelistMapping();
      let isWhitelistedTransferer = await cst.whitelistedTransferer(whitelistedTransferer);

      assert.equal(totalWhitelistedTransferers.toNumber(), 0, 'the totalTransferWhitelistMapping is correct');
      assert.notOk(isWhitelistedTransferer, "the whitelisted transferer is not set");
    });
  });

});
