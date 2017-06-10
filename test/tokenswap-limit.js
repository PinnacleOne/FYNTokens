var should = require('should');
var _ = require('lodash');
var Promise = require('bluebird');
var helpers = require('./helpers');

var Wallet = artifacts.require("Wallet.sol");
var Token = artifacts.require("Token.sol");
var SimpleWallet = artifacts.require("SimpleWallet.sol");

function containsObject(obj, list) {
    var i;
    for (i = 0; i < list.length; i++) {
        if ((list[i].logIndex === obj.logIndex) && (list[i].transactionHash === obj.transactionHash)) {
            return true;
        }
    }
    return false;
}

contract('Tokenswap', function(accounts) {
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
         if (!containsObject(event, walletEvents))
         walletEvents.push(event);
      });
    }
    if (token) {
      token_watcher = token.allEvents({}, function (error, event) {
         if (!containsObject(event, walletEvents))
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

  describe("Token Swap (Testing Token Limit Hit)", function() {
    before(function() {
      // Create a new wallet with a limit of 5
      return Wallet.new([accounts[1], accounts[2]], 2, web3.toWei(5, "ether"), {from: accounts[0]})
      .then(function(result) {
        wallet = result;
        return Token.new( 11100000e18, result.address, 1497074400, { from: accounts[0] } ); // Starts on 2017/6/10 2pm, 3 days before
        //return Token.new( 1e20, result.address,1495925635, { from: accounts[0] } );
      })
      .then(function(result) {
        token = result;
        wallet.setTokenContract( token.address );
      })
    });

    it("Token Swap Disabled", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return Promise.resolve()
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      });
    });
    
    it("Token Swap Enabled - Check Mint for first 3 days (Presale) (Less than 20 ETH)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.startTokenSwap()
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      });
    });
 
    it("Token Swap Enabled - Check Mint for first 3 days (Presale) (More than 20 ETH) - Token Limit Hit With This Tx", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.startTokenSwap()
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(10000,'ether'), gas: 1e6})
      })
      .then(function() {
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther.add(10000));
        return helpers.waitForEvents(walletEvents, 3); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Deposit
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Deposit';
        });
        confirmationEvent.args._from.should.eql(accounts[2]);
        confirmationEvent.args.value.should.eql( web3.toBigNumber(web3.toWei(10000, 'ether')) );
        // Check wallet events for TokenMint
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'TokenMint';
        });
        confirmationEvent.args.newTokenHolder.should.eql(accounts[2]);
        confirmationEvent.args.amountOfTokens.should.eql( web3.toBigNumber(web3.toWei(10000, 'ether') * 140));
        // Check wallet events for TokenSwapOver
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'TokenSwapOver';
        });
        should.exist( confirmationEvent );
      })
    }); 

    it("Token Swap Enabled - Check Mint after first 3 days - Token Limit Already Hit", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var snapshot_id;  
      //Promise.delay(1000)
      return web3.evm.increaseTime(86400*3)
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      });
    });


    
    it("Token Swap Enabled - Check Mint after first 3 weeks + 3 days - Token Limit Already Hit" , function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      var snapshot_id;  

      //Promise.delay(1000)
      return web3.evm.increaseTime(86400*26)
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      });
    });

    it("Token Swap Enabled - Check Mint after sale - Token Limit Already Hit", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return web3.evm.increaseTime(86400*22)
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      });
    });

    it("Withdraw Reserve, should throw, supply shouldn't change - Token Limit Already Hit", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.withdrawReserve(accounts[0], {from: accounts[2]})
      .then(function() {
        assert(false,"Should have thrown!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
      })

      return token.totalSupply()
      .then(function(totalSupply) {
        totalSupply.should.eql( web3.toBigNumber( 12500000 * 1e18 ) );
      })
    });

    it("Kill Wallet without Activating Emergency Stop (should throw)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.kill( accounts[2], {from: accounts[0]})
      .then(function() {
        return wallet.kill( accounts[2], {from: accounts[1]})
      })
      .then(function() {
        assert(false,"Should have thrown! Kill Wallet without activating Emergency Stop");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(accounts[2]),'ether').should.eql(otherAccountStartEther);
      })
    });

    it("Activate Emergency Stop for Token (multisig test)", function () {
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.stopToken( {from: accounts[0]} )
      .then(function() {
        return wallet.stopToken( {from: accounts[1]} )
      }) 
      .then(function() {
        return helpers.waitForEvents(walletEvents, 1); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for EmergencyStopActivated
        var stopEvent = _.find(walletEvents, function(event) {
          return event.event === 'EmergencyStopActivated';
        });
        should.exist(stopEvent);
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(5,'ether')})
      })
      .then(function(retVal) {
        assert(false, "Supposed to throw but didnt!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        web3.fromWei(web3.eth.getBalance(wallet.address),'ether').should.eql(msigWalletStartEther);
      })
    });

    it("Kill Wallet (multisig test)", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.kill( accounts[2], {from: accounts[0]})
      .then(function() {
        return wallet.kill( accounts[2], {from: accounts[1]})
      })
      .then(function() {
        web3.fromWei(web3.eth.getBalance(accounts[2]),'ether').should.eql(msigWalletStartEther.add(otherAccountStartEther));
      })
    });
  });
});


