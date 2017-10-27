module.exports = {
  networks: {
    // this is for auotmated testing and development
    development: {
      host: "localhost",
      port: 8545,
      network_id: "*" // Match any network id
    },

    // this is for testing migration and mist in testrpc
    testrpc: {
      host: "localhost",
      port: 8545,
      network_id: "*" // Match any network id
    },

    rinkeby: {
      host: "localhost", // Connect to geth on the specified
      port: 8545,
      from: "0xf5467A3565995F276F51A74D396F7f9079FF43cB",
      network_id: 4,
      gasPrice: 30000000000 // Default is 100 GWEI (100000000000), which is very fast
    },

    rinkeby_docker: {
      host: "localhost", // Connect to geth on the specified
      port: 9545,
      network_id: 4,
      gasPrice: 30000000000 // Default is 100 GWEI (100000000000), which is very fast
    },

    mainnet: {
      host: "localhost", // Connect to geth on the specified
      port: 8545,
      from: "", //TODO populate with the main address from secure terminal wallet
      network_id: 1,
      gasPrice: 30000000000 // Default is 100 GWEI (100000000000), which is very fast
    }
  }
};
