var should = require('should');
var _ = require('lodash');
var Promise = require('bluebird');
var helpers = require('./helpers');

var Wallet = artifacts.require("Wallet.sol");
var Token = artifacts.require("Token.sol");
var SimpleWallet = artifacts.require("SimpleWallet.sol");

contract('Wallet', function(accounts) {
  var wallet;
  var walletEvents;
  var watcher;
  var token;
  var simpleWallet;
  var token_watcher;

  beforeEach(function() {
    if (wallet) {
      walletEvents = [];
      // Set up event watcher
      watcher = wallet.allEvents({}, function (error, event) {
        walletEvents.push(event);
      });
    }
    if (token) {
      token_watcher = token.allEvents({}, function (error, event) {
        walletEvents.push(event);
      });
    }
  });
  afterEach(function() {
    if (watcher) {
      watcher.stopWatching();
    }
    if (token_watcher) {
      token_watcher.stopWatching();
    }
  });

  /**
   * Helper method to get owners on the wallet
   *
   * @param wallet
   * @returns array of owners on the wallet
   */
  var getOwners = function(wallet) {
    return wallet.m_numOwners.call()
    .then(function (numOwners) {
      return Promise.all(
        _.range(numOwners).map(function (ownerIndex) {
          return wallet.getOwner.call(ownerIndex);
        })
      );
    });
  };

  describe('Wallet creation', function() {
    it("2 of 3 multisig wallet with 2 required and limit of 0", function () {
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(0, "ether"), {from: accounts[0]}).then(function(result) {
        wallet = result;
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.m_dailyLimit.call()
        ])
      })
      .then(function([numOwners, signaturesRequired, dailyLimit]) {
        numOwners.should.eql(web3.toBigNumber(3));
        signaturesRequired.should.eql(web3.toBigNumber(2));
        dailyLimit.should.eql(web3.toBigNumber(0));
        // Check the list of owners
        return Promise.all([
          wallet.isOwner.call(accounts[0]),
          wallet.isOwner.call(accounts[1]),
          wallet.isOwner.call(accounts[2]),
          wallet.isOwner.call(accounts[3])
        ]);
      })
      .then(function(isOwnerResults) {
        isOwnerResults.length.should.eql(4);
        isOwnerResults[0].should.eql(true);
        isOwnerResults[1].should.eql(true);
        isOwnerResults[2].should.eql(true);
        isOwnerResults[3].should.eql(false);
  
        // Gets owners by index
        return getOwners(wallet);
      })
      .then(function(owners) {
        owners.length.should.eql(3);
        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);
      });
    });
  
    it("M of N multisig wallets with different configurations", function () {
      var walletCreateTest = function(params) {
        var numAccounts = params.numAccounts || 3;
        var signaturesRequired = params.signaturesRequired || 2;
        var dailyLimit = params.dailyLimit || 10;
  
        //console.log("Testing numAccounts: " + numAccounts + ", signaturesRequired: " + signaturesRequired + ", dailyLimit: " + dailyLimit + " ETH");
        return Wallet.new(accounts.slice(1, numAccounts), signaturesRequired, web3.toWei(dailyLimit, "ether"), {from: accounts[0]})
        .then(function (result) {
          wallet = result;
          return Promise.all([
            wallet.m_numOwners.call(),
            wallet.m_required.call(),
            wallet.m_dailyLimit.call()
          ]);
        })
        .then(function([numOwners, signaturesRequired, dailyLimit]) {
          //console.log("Verifying numOwners: " + numOwners + ", signaturesRequired: "+ signaturesRequired + ", dailyLimit: " + dailyLimit);
          numOwners.should.eql(web3.toBigNumber(numAccounts));
          signaturesRequired.should.eql(web3.toBigNumber(signaturesRequired));
          dailyLimit.should.eql(web3.toBigNumber(dailyLimit));
  
          return getOwners(wallet);
        })
        .then(function(owners) {
          // compare accounts with expected owners
          // we sliced starting at 1 above because the sender is always included as an owner,
          // but we should check starting with a slice of 0
          _.intersection(accounts.slice(0, numAccounts), owners).length.should.eql(numAccounts);
        });
      };
  
      return Promise.resolve([
        { numAccounts: 1, signaturesRequired: 1, dailyLimit: 1 },
        { numAccounts: 2, signaturesRequired: 2, dailyLimit: 10000 },
        { numAccounts: 10, signaturesRequired: 5, dailyLimit: 50 }
      ]).map(walletCreateTest, { concurrency: 1 });
    });
  
  });
  
  describe("Deposits", function() {
    before(function() {
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(100, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
      });
    });
  
    it("Should emit event on deposit", function () {
      Wallet.deployed().then(function() {
       return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(1, "ether")})
      })
      .then(function() {
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        var depositEvent = _.find(walletEvents, function(event) {
          return event.event === 'Deposit';
        });
        depositEvent.args._from.should.eql(accounts[0]);
        depositEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(1, "ether")));
      });
    });
  });

  describe("Transaction execution (under daily limit)", function() {
    before(function() {
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(100, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[1], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    })
  
    it("Send out 50 ether as a user not on the wallet (should fail)", function () {
      var otherAccountStartEther;
      var msigWalletStartEther;
      return Promise.resolve().then(function() {
        otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        // Send 50 ether out of the wallet contract via a non owner
        return wallet.execute(accounts[2], web3.toWei(50, "ether"), "", { from: accounts[5] })
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
        
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });
  
    it("Send out 51 ether as a single user (under the limit)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
  
      // Send 51 ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(51, "ether"), "", { from: accounts[0] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(51).should.eql(otherAccountEndEther);
  
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(51).should.eql(msigWalletEndEther);
  
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events
        var singleTransactEvent = _.find(walletEvents, function(event) {
          return event.event === 'SingleTransact';
        });
        singleTransactEvent.args.owner.should.eql(accounts[0]);
        singleTransactEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(51, "ether")));
        singleTransactEvent.args.to.should.eql(accounts[2]);
      });
    });
  
    it("Send out another 60 ether as a single user (total 110, over the limit, fails)", function () {
      var otherAccount = accounts[2];
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
  
      // Send ether out of the wallet contract
      return wallet.execute(otherAccount, web3.toWei(60, "ether"), "", { from: accounts[0] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
  
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });
  
    it("Send out another 49 ether as a another single user (just at the limit)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
  
      
      // Send 49 ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(49, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(49).should.eql(otherAccountEndEther);
  
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(49).should.eql(msigWalletEndEther);
      });
    });
  
    it("Send out another 1 ether as a another single user (over the limit, fails)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
  
      // Send ether out of the wallet contract
      Wallet.deployed().then(function() { 
        return wallet.execute(accounts[2], web3.toWei(1, "ether"), "", { from: accounts[1] })
      }) 
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
  
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });
  });
 
  describe("Transaction execution (over daily limit, requiring a confirmation tx)", function() {
    before(function() {
      // Create a new wallet with a limit of 0
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(0, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
        return SimpleWallet.new([accounts[3]], 1, web3.toWei(100, "ether"), { from: accounts[0] });
      })
      .then(function(result) {
        simpleWallet = result;
      });
    });

    it("Execute a withdrawal and confirm with another transaction", function () {
      var otherAccount = accounts[2];
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      // Send ether out of the wallet contract
      return wallet.execute(otherAccount, web3.toWei(10, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(10, "ether")));
        confirmationNeededEvent.args.to.should.eql(otherAccount);
        operationHash = confirmationNeededEvent.args.operation;
        
        return wallet.confirm(operationHash, { from: accounts[0] });
      })
      .then(function(result) {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(10).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(10).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for MultiTransact event
        var multiTransactEvent = _.find(walletEvents, function(event) {
          return event.event === 'MultiTransact';
        });
        multiTransactEvent.args.owner.should.eql(accounts[0]);
        multiTransactEvent.args.operation.should.eql(operationHash);
        multiTransactEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(10, "ether")));
        multiTransactEvent.args.to.should.eql(otherAccount);
      });
    });

    it("Execute another withdrawal and confirm it (destination address equals approver account)", function () {
      var destination = accounts[2];
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(destination), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(15, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(destination), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(15, "ether")));
        confirmationNeededEvent.args.to.should.eql(destination);
        operationHash = confirmationNeededEvent.args.operation;
        return wallet.confirm(operationHash, { from: destination });
      })
      .then(function(txHash) {
        // need to get tx/txReceipt to subtract gas*gasPrice (the network fee) from account 2 balance
        var tx = web3.eth.getTransaction(txHash["tx"]);
        var txReceipt = txHash["receipt"];
        var feePaid = web3.fromWei(tx.gasPrice.times(txReceipt.gasUsed), 'ether');
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(destination), 'ether');
        otherAccountStartEther.plus(15).minus(feePaid).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(15).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for MultiTransact event
        var multiTransactEvent = _.find(walletEvents, function(event) {
          return event.event === 'MultiTransact';
        });
        multiTransactEvent.args.owner.should.eql(destination);
        multiTransactEvent.args.operation.should.eql(operationHash);
        multiTransactEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(15, "ether")));
        multiTransactEvent.args.to.should.eql(destination);
      });
    });

    it("All transactions sending to contracts (code execution) should require multiple confirmations", function () {
      var otherAccount = simpleWallet.address; // wallet is a contract
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send data out of the wallet contract
      return wallet.execute(otherAccount, web3.toWei(0, "ether"), "0xabcd", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(0, "ether")));
        confirmationNeededEvent.args.to.should.eql(otherAccount);
        operationHash = confirmationNeededEvent.args.operation;

        return wallet.confirm(operationHash, { from: accounts[2] });
      })
      .then(function(txHash) {
        // need to get tx/txReceipt to subtract gas*gasPrice (the network fee) from account 2 balance
        var tx = web3.eth.getTransaction(txHash["tx"]);
        var txReceipt = web3.eth.getTransactionReceipt(txHash["tx"]);
        var feePaid = web3.fromWei(tx.gasPrice.times(txReceipt.gasUsed), 'ether');
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for MultiTransact event
        var multiTransactEvent = _.find(walletEvents, function(event) {
          return event.event === 'MultiTransact';
        });
        multiTransactEvent.args.owner.should.eql(accounts[2]);
        multiTransactEvent.args.operation.should.eql(operationHash);
        multiTransactEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(0, "ether")));
        multiTransactEvent.args.to.should.eql(otherAccount);
      });
    });

    it("All transactions with data should require multiple confirmations", function () {
      var otherAccount = simpleWallet.address;
      var otherAccountStartEther = otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

        // Send to other contract
      return wallet.execute(otherAccount, web3.toWei(0, "ether"), "0xab3456", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.data.should.eql("0xab3456");
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(0, "ether")));
        confirmationNeededEvent.args.to.should.eql(otherAccount);
        operationHash = confirmationNeededEvent.args.operation;
        return wallet.confirm(operationHash, { from: accounts[0] });
      })
      .then(function(txHash) {
        // need to get tx/txReceipt to subtract gas*gasPrice (the network fee) from account 2 balance
        var tx = web3.eth.getTransaction(txHash["tx"]);
        var txReceipt = web3.eth.getTransactionReceipt(txHash["tx"]);
        var feePaid = web3.fromWei(tx.gasPrice.times(txReceipt.gasUsed), 'ether');
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for MultiTransact event
        var multiTransactEvent = _.find(walletEvents, function(event) {
          return event.event === 'MultiTransact';
        });
        multiTransactEvent.args.owner.should.eql(accounts[0]);
        multiTransactEvent.args.operation.should.eql(operationHash);
        multiTransactEvent.args.data.should.eql("0xab3456");
        multiTransactEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(0, "ether")));
        multiTransactEvent.args.to.should.eql(otherAccount);
      });
    });

    it("Execute a withdrawal and try to confirm their own execution from same account (should fail)", function () {
      var otherAccount = accounts[2];
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(otherAccount, web3.toWei(11, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(11, "ether")));
        confirmationNeededEvent.args.to.should.eql(otherAccount);
        operationHash = confirmationNeededEvent.args.operation;
        return wallet.confirm(operationHash, { from: accounts[1] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });

    it("Execute a withdrawal and try to confirm with a non-owner (should fail)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(12, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(12, "ether")));
        confirmationNeededEvent.args.to.should.eql(accounts[2]);
        operationHash = confirmationNeededEvent.args.operation;
        return wallet.confirm(operationHash, { from: accounts[9] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });

    it("Execute a withdrawal from a non-owner and try to confirm with an owner (should fail)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      // Send 25 ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(13, "ether"), "", {from: accounts[9]})
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return wallet.execute(accounts[2], web3.toWei(13, "ether"), "", {from: accounts[1]});
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

      });
    });
  });

  describe("Revoke pending transactions", function() {
    before(function() {
      // Create a new wallet with a limit of 0
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(0, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Execute a withdrawal, revoke the execution, then attempt confirm (should fail)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(10, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function (event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(10, "ether")));
        confirmationNeededEvent.args.to.should.eql(accounts[2]);
        operationHash = confirmationNeededEvent.args.operation;

        return wallet.revoke(operationHash, {from: accounts[1]});
      })
      .then(function() {
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Revoke
        var revokeEvent = _.find(walletEvents, function (event) {
          return event.event === 'Revoke';
        });
        revokeEvent.args.owner.should.eql(accounts[1]);
        revokeEvent.args.operation.should.eql(operationHash);

        return wallet.confirm(operationHash, { from: accounts[0] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });

    it("Execute a withdrawal, revoke the execution (as non owner), then attempt confirm (should succeed)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(10, "ether"), "", { from: accounts[1] })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function (event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(10, "ether")));
        confirmationNeededEvent.args.to.should.eql(accounts[2]);
        operationHash = confirmationNeededEvent.args.operation;

        return wallet.revoke(operationHash, {from: accounts[4]});
      })
      .then(function() {
        return wallet.confirm(operationHash, { from: accounts[0] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(10).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(10).should.eql(msigWalletEndEther);
      });
    });
  });

  describe("Add owners / multiowner logic", function() {
    before(function() {
      // Create a new wallet with a limit of 0
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(0, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Adding a new owner should require a confirmation", function () {
      var oldEventCount;

      // Send ether out of the wallet contract
      return wallet.addOwner(accounts[9], {from: accounts[1]})
      .then(function () {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[9]),
          getOwners(wallet)
        ]);
      })
      .then(function ([numOwners, signaturesRequired, isOwner, owners]) {
        numOwners.should.eql(web3.toBigNumber(3)); // new owner not added yet
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner.should.eql(false);

        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);
        owners.should.not.containEql(accounts[9]);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[1]);
        confirmationEvent.args.should.have.property('operation');

        oldEventCount = walletEvents.length; // record the old event count

        // attempt to spend by the new owner before they've been confirmed should not work
        return wallet.execute(accounts[9], web3.toWei(10, "ether"), [], {from: accounts[9]});
      })
      .then(function () {
        return helpers.waitForEvents(walletEvents, 0); // wait for events to come in
      })
      .then(function () {
        // Expect no events to have come in (the owner was not confirmed)
        walletEvents.length.should.eql(oldEventCount);
      });
    });

    it("Non-owner cannot confirm adding an owner", function () {
      // Send ether out of the wallet contract
      return wallet.addOwner(accounts[8], {from: accounts[1]})
      .then(function () {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[8])
        ]);
      })
      .then(function ([numOwners, signaturesRequired, isOwner]) {
        numOwners.should.eql(web3.toBigNumber(3)); // new owner not added yet
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner.should.eql(false);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[1]);
        confirmationEvent.args.should.have.property('operation');

        // new owner attempts to add themselves
        return wallet.addOwner(accounts[8], {from: accounts[8]});
      })
      .then(function () {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[8])
        ]);
      })
      .then(function ([numOwners, signaturesRequired, isOwner]) {
        numOwners.should.eql(web3.toBigNumber(3)); // new owner not added yet
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner.should.eql(false);
      });
    });

    it("After a new owner is added they should be able to transact", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;
      var amount = 9;

      // Send ether out of the wallet contract
      return Promise.resolve()
      .then(function () {
        return wallet.addOwner(accounts[3], {from: accounts[0]});
      })
      .then(function () {
        return wallet.addOwner(accounts[3], {from: accounts[1]});
      })
      .then(function () {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[3])
        ]);
      })
      .then(function ([numOwners, signaturesRequired, isOwner]) {
        numOwners.should.eql(web3.toBigNumber(4));
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner.should.eql(true);
        return getOwners(wallet);
      })
      .then(function(owners) {
        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);
        owners.should.containEql(accounts[3]);

        return helpers.waitForEvents(walletEvents, 3);
      })
      .then(function () {
        var ownerAddedEvent = _.find(walletEvents, function (event) {
          return event.event === 'OwnerAdded';
        });
        ownerAddedEvent.args.newOwner.should.eql(accounts[3]);
        return wallet.execute(accounts[3], web3.toWei(amount, 'ether'), [], {from: accounts[3], gasPrice: 0});
      })
      .then(function () {
        return helpers.waitForEvents(walletEvents);
      })
      .then(function () {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function (event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[3]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(amount, 'ether')));
        confirmationNeededEvent.args.to.should.eql(accounts[3]);
        operationHash = confirmationNeededEvent.args.operation;

        return wallet.confirm(operationHash, {from: accounts[1]});
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
        otherAccountStartEther.plus(amount).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(amount).should.eql(msigWalletEndEther);
      });
    });

    it("New owners should not be able to approve old pending transactions", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;

      // Send ether out of the wallet contract
      return wallet.execute(accounts[2], web3.toWei(10, "ether"), [], {from: accounts[0]})
      .then(function () {
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function (event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[0]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(10, "ether")));
        confirmationNeededEvent.args.to.should.eql(accounts[2]);
        operationHash = confirmationNeededEvent.args.operation;

        return wallet.addOwner(accounts[4], {from: accounts[0]});
      })
      .then(function () {
        return wallet.addOwner(accounts[4], {from: accounts[1]});
      })
      .then(function () {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.isOwner.call(accounts[4]),
          getOwners(wallet)
        ]);
      })
      .then(function ([numOwners, isOwner, owners]) {
        numOwners.should.eql(web3.toBigNumber(5));
        isOwner.should.eql(true);

        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);
        owners.should.containEql(accounts[4]);

        return wallet.confirm(operationHash, {from: accounts[4]});
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });
  });
  
  describe("Remove owners", function() {
    before(function() {
      // Create a new wallet with a limit of 80
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(80, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Removing an owner should require a confirmation", function () {
      return wallet.removeOwner(accounts[0], { from: accounts[0] })
      .then(function() {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.isOwner.call(accounts[0]),
          getOwners(wallet)
        ]);
      })
      .then(function([numOwners, isOwner, owners]) {
        numOwners.should.eql(web3.toBigNumber(3));
        isOwner.should.eql(true);

        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[0]);
        confirmationEvent.args.should.have.property('operation');
      });
    });

    it("Removing an owner should prevent them from making transactions", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      return wallet.removeOwner(accounts[1], {from: accounts[0]})
      .then(function () {
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[0]);
        confirmationEvent.args.should.have.property('operation');

        return wallet.removeOwner(accounts[1], {from: accounts[1]});
      })
      .then(function () {
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        var ownerRemovedEvent = _.find(walletEvents, function (event) {
          return event.event === 'OwnerRemoved';
        });
        ownerRemovedEvent.args.oldOwner.should.eql(accounts[1]);

        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[1]),
          getOwners(wallet)
        ]);
      })
      .then(function ([numOwners, signaturesRequired, isOwner, owners]) {
        numOwners.should.eql(web3.toBigNumber(2));
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner.should.eql(false);

        owners.should.containEql(accounts[0]);
        owners.should.not.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);

        return wallet.execute(accounts[2], web3.toWei(1, "ether"), "", { from: accounts[1] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });
  });

  describe("Change number of required signers", function() {
    before(function() {
      // Create a new wallet with a limit of 0
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(0, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Changing number of required signers requires a confirmation", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[9]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      return wallet.changeRequirement(1, { from: accounts[2] })
      .then(function() {
        return wallet.m_required.call();
      })
      .then(function(signaturesRequired) {
        signaturesRequired.should.eql(web3.toBigNumber(2));
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[2]);
        confirmationEvent.args.should.have.property('operation');
        return wallet.execute(accounts[9], web3.toWei(1, "ether"), "", { from: accounts[1] });
      })
      .then(function() {
        // Check that there were no balance changes
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[9]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });

    it("Changing number of required signers to 3 and make a transaction with 3 signers", function () {
      var otherAccount = accounts[4];
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var operationHash;
      var amount = 100;

      return Promise.all([
        wallet.changeRequirement(3, { from: accounts[0] }),
        wallet.changeRequirement(3, { from: accounts[1] }),
        wallet.changeRequirement(3, { from: accounts[2] })
      ])
      .then(function () {
        return wallet.m_required.call();
      })
      .then(function(signaturesRequired) {
        signaturesRequired.should.eql(web3.toBigNumber(3));
        return helpers.waitForEvents(walletEvents, 4); // wait for events to come in
      })
      .then(function () {
        var requirementChangedEvent = _.find(walletEvents, function (event) {
          return event.event === 'RequirementChanged';
        });
        requirementChangedEvent.args.newRequirement.should.eql(web3.toBigNumber(3));

        // Now make a transaction
        return wallet.execute(otherAccount, web3.toWei(amount, "ether"), "", { from: accounts[0] });
      })
      .then(function () {
        // Check that balances have not changed yet
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function () {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function (event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[0]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(amount, "ether")));
        confirmationNeededEvent.args.to.should.eql(otherAccount);
        operationHash = confirmationNeededEvent.args.operation;
        return wallet.confirm(operationHash, { from: accounts[1] });
      })
      .then(function () {
        // Check that balances have not changed yet
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
        return wallet.confirm(operationHash, { from: accounts[2] });
      })
      .then(function() {
        // Check that balances were changed
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(otherAccount), 'ether');
        otherAccountStartEther.plus(amount).should.eql(otherAccountEndEther);
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(amount).should.eql(msigWalletEndEther);
      });
    });
  });

  describe("Change Owners", function() {
    before(function() {
      // Create a new wallet with a limit of 1000
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(1000, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Changing an owner should require a confirmation", function () {
      // Change owner from account 0 to 5
      return wallet.changeOwner(accounts[0], accounts[5], { from: accounts[0] })
      .then(function() {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.isOwner.call(accounts[0]),
          wallet.isOwner.call(accounts[5]),
          getOwners(wallet)
        ]);
      })
      .then(function([numOwners, isOwner0, isOwner5, owners]) {
        numOwners.should.eql(web3.toBigNumber(3));
        isOwner0.should.eql(true);
        isOwner5.should.eql(false);
        owners.should.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[0]);
        confirmationEvent.args.should.have.property('operation');
      });
    });

    it("Confirming an owner change removes the old owner and renders them unable to execute transactions", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[7]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      // Change owner from account 0 to 5
      return wallet.changeOwner(accounts[0], accounts[5], { from: accounts[2] })
      .then(function() {
        return wallet.changeOwner(accounts[0], accounts[5], { from: accounts[1] });
      })
      .then(function() {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[0]),
          wallet.isOwner.call(accounts[5]),
          getOwners(wallet)
        ]);
      })
      .then(function([numOwners, signaturesRequired, isOwner0, isOwner5, owners]) {
        numOwners.should.eql(web3.toBigNumber(3));
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner0.should.eql(false);
        isOwner5.should.eql(true);
        owners.should.not.containEql(accounts[0]);
        owners.should.containEql(accounts[1]);
        owners.should.containEql(accounts[2]);
        owners.should.containEql(accounts[5]);

        return wallet.execute(accounts[7], web3.toWei(1, "ether"), "", { from: accounts[0] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[7]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents);
      })
      .then(function() {
        // Check wallet events for OwnerChanged
        var ownerChangedEvent = _.find(walletEvents, function (event) {
          return event.event === 'OwnerChanged';
        });
        ownerChangedEvent.args.oldOwner.should.eql(accounts[0]);
        ownerChangedEvent.args.newOwner.should.eql(accounts[5]);
      });
    });

    it("Confirming an owner change give the new owner ability to execute transactions", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[8]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      // Change owner from account 2 to 4
      return wallet.changeOwner(accounts[2], accounts[4], { from: accounts[2] })
      .then(function() {
        return wallet.changeOwner(accounts[2], accounts[4], { from: accounts[1] });
      })
      .then(function() {
        // Check numerical constants
        return Promise.all([
          wallet.m_numOwners.call(),
          wallet.m_required.call(),
          wallet.isOwner.call(accounts[2]),
          wallet.isOwner.call(accounts[4])
        ]);
      })
      .then(function([numOwners, signaturesRequired, isOwner2, isOwner4]) {
        numOwners.should.eql(web3.toBigNumber(3));
        signaturesRequired.should.eql(web3.toBigNumber(2));
        isOwner2.should.eql(false);
        isOwner4.should.eql(true);

        return wallet.execute(accounts[8], web3.toWei(3, "ether"), "", { from: accounts[4] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[8]), 'ether');
        otherAccountStartEther.plus(3).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(3).should.eql(msigWalletEndEther);

        // Try to make another transaction, but exceeding the daily limit - should not go out (require confirm)
        return wallet.execute(accounts[8], web3.toWei(1000, "ether"), "", { from: accounts[4] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[8]), 'ether');
        otherAccountStartEther.plus(3).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(3).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents);
      })
      .then(function() {
        // Check wallet events for OwnerChanged
        var ownerChangedEvent = _.find(walletEvents, function (event) {
          return event.event === 'OwnerChanged';
        });
        ownerChangedEvent.args.oldOwner.should.eql(accounts[2]);
        ownerChangedEvent.args.newOwner.should.eql(accounts[4]);
      });
    });
  });
 
  describe("Daily limit", function() {
    before(function() {
      // Create a new wallet with a limit of 5
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(5, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 1e20, result.address, 1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
        wallet.startTokenSwap();
        return Promise.delay(1000);
      })
      .then(function(result) {
        // Send 2000 ether into the wallet contract
        return web3.eth.sendTransaction({from: accounts[0], to: wallet.address, value: web3.toWei(2000, "ether")});
      })
      .then(function() {
        wallet.stopTokenSwap();
        web3.fromWei(web3.eth.getBalance(wallet.address), 'ether').should.eql(web3.toBigNumber(2000));
      });
    });

    it("Changing a daily limit should require a confirmation", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      return wallet.setDailyLimit(web3.toWei(10, "ether"), { from: accounts[0] })
      .then(function() {
        return wallet.m_dailyLimit.call();
      })
      .then(function(dailyLimit) {
        dailyLimit.should.eql(web3.toBigNumber(web3.toWei(5, "ether")));

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Confirmation
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Confirmation';
        });
        confirmationEvent.args.owner.should.eql(accounts[0]);
        confirmationEvent.args.should.have.property('operation');

        // this execution should not have effect since the daily limit is still 5
        return wallet.execute(accounts[2], web3.toWei(10, "ether"), "", { from: accounts[1] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);
      });
    });

    it("Changing a daily limit causes new daily limit to be enforced", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      return wallet.setDailyLimit(web3.toWei(0, "ether"), { from: accounts[2] })
      .then(function() {
        return wallet.setDailyLimit(web3.toWei(0, "ether"), {from: accounts[1]});
      })
      .then(function() {
        // Check numerical constants
        return wallet.m_dailyLimit.call();
      })
      .then(function(dailyLimit) {
        dailyLimit.should.eql(web3.toBigNumber(web3.toWei(0, "ether")));
        // this execution should now require a confirmation needed
        return wallet.execute(accounts[3], web3.toWei(1, "ether"), "", { from: accounts[1] });
      })
      .then(function() {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
        otherAccountStartEther.plus(0).should.eql(otherAccountEndEther);

        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(0).should.eql(msigWalletEndEther);

        return helpers.waitForEvents(walletEvents); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for ConfirmationNeeded
        var confirmationNeededEvent = _.find(walletEvents, function(event) {
          return event.event === 'ConfirmationNeeded';
        });
        confirmationNeededEvent.args.initiator.should.eql(accounts[1]);
        confirmationNeededEvent.args.value.should.eql(web3.toBigNumber(web3.toWei(1, "ether")));
        confirmationNeededEvent.args.to.should.eql(accounts[3]);
      });
    });

    it("Resetting a daily limit requires a confirmation", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');

      // First set the daily limit to 2 ether
      return wallet.setDailyLimit(web3.toWei(2, "ether"), { from: accounts[2] })
      .then(function () {
        return wallet.setDailyLimit(web3.toWei(2, "ether"), { from: accounts[1] });
      })
      .then(function () {
        // now make an execution for 1 ether, which should not need a confirmation
        return wallet.execute(accounts[3], web3.toWei(1, "ether"), "", { from: accounts[1] });
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
        otherAccountStartEther.plus(1).should.eql(otherAccountEndEther);
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(1).should.eql(msigWalletEndEther);

        // Reset the spend (but only 1 user)
        return wallet.resetSpentToday({from: accounts[0]});
      })
      .then(function () {
        // Now make an execution for another 1.5 ether - this should not work
        return wallet.execute(accounts[3], web3.toWei(1.5, "ether"), "", { from: accounts[1] });
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
        otherAccountStartEther.plus(1).should.eql(otherAccountEndEther);
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(1).should.eql(msigWalletEndEther);

        // Reset the spend from another user
        return wallet.resetSpentToday({from: accounts[2]});
      })
      .then(function () {
        // Now make an execution for 2 ether - this should work since we reset the spend
        return wallet.execute(accounts[3], web3.toWei(2, "ether"), "", { from: accounts[1] });
      })
      .then(function () {
        // Check other account balance
        var otherAccountEndEther = web3.fromWei(web3.eth.getBalance(accounts[3]), 'ether');
        otherAccountStartEther.plus(3).should.eql(otherAccountEndEther);
        // Check wallet balance
        var msigWalletEndEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
        msigWalletStartEther.minus(3).should.eql(msigWalletEndEther);
      });
    });
  });

});


