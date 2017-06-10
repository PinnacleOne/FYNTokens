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

contract('ERC20 Token', function(accounts) {
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

  describe("ERC20 Functionality Test with Transfer Stop Tests", function() {
    before(function() {
      // Create a new wallet with a limit of 5
      return Wallet.new([accounts[1], accounts[2]], 1, web3.toWei(5, "ether"), {from: accounts[0]})
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

    it("Limits not hit, ERC20 functions should throw, testing Transfer from Wallet", function () {
      var initialNumberOfTokens;
      return token.transferStop()
      .then(function(value) {
        value.should.eql(true);
        return token.balanceOf(accounts[0]);
      })
      .then(function(value) {
        initialNumberOfTokens = web3.toBigNumber(value);
        return token.transfer.sendTransaction(accounts[2], 1e18, {from: accounts[0]});
      })
      .then(function() {
        assert(false,"Should have thrown!");
      })
      .catch(function(error) {
        helpers.checkIfThrown(error);
        return token.balanceOf(accounts[0]); 
      })
      .then(function(bal) {
        web3.toBigNumber(bal).should.eql(initialNumberOfTokens); 
      })
    });

    it("Token Swap Enabled - Check Mint for first 3 days (Presale) (More than 20 ETH) - Token Limit Hit With This Tx", function () {
      var otherAccountStartEther = web3.fromWei(web3.eth.getBalance(accounts[2]), 'ether');
      var msigWalletStartEther = web3.fromWei(web3.eth.getBalance(wallet.address), 'ether');
      return wallet.startTokenSwap()
      .then(function() {
        return web3.eth.sendTransaction({from: accounts[2], to: wallet.address, value: web3.toWei(10000,'ether'), gas: 1e6})
      })
      .then(function(error) {
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

    it("Token Limit Hit, ERC20 functions should be activated, testing Transfer from Wallet", function () {
      var initialNumberOfTokens;
      return token.transferStop()
      .then(function(value) {
        value.should.eql(false);
        return token.balanceOf(accounts[0]);
      })
      .then(function(value) {
        initialNumberOfTokens = web3.toBigNumber(value);
        return token.transfer.sendTransaction(accounts[2], 1e18, {from: accounts[0]});
      })
      .then(function() {
        return token.balanceOf(accounts[0]); 
      })
      .then(function(bal) {
        web3.toBigNumber(bal).should.eql(initialNumberOfTokens.add(-1e18)); 
        walletEvents = [];
        return helpers.waitForEvents(walletEvents, 1); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Deposit
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Transfer';
        });
        confirmationEvent.args.from.should.eql(accounts[0]);  
        confirmationEvent.args.to.should.eql(accounts[2]);  
        confirmationEvent.args.value.should.eql( web3.toBigNumber(1e18) );  
      });
    });

    it("Token Limit Hit, ERC20 functions should be activated, testing Approve and Transfer From", function () {
      var initialNumberOfTokens;
      return token.transferStop()
      .then(function(value) {
        value.should.eql(false);
        return token.balanceOf(accounts[0]);
      })
      .then(function(value) {
        walletEvents = [];
        initialNumberOfTokens = web3.toBigNumber(value);
        return token.approve.sendTransaction(accounts[2], 10e18, {from: accounts[0]});
      })
      .then(function() {
        return helpers.waitForEvents(walletEvents, 1); // wait for events to come in
      }) 
      .then(function() {
        // Check wallet events for Approval
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Approval';
        });
        confirmationEvent.args.owner.should.eql(accounts[0]);  
        confirmationEvent.args.spender.should.eql(accounts[2]);  
        confirmationEvent.args.value.should.eql( web3.toBigNumber(10e18) );  
        return token.transferFrom( accounts[0], accounts[1], 1e18, {from: accounts[2]} );
      }) 
      .then(function() {
        return token.balanceOf(accounts[0]); 
      })
      .then(function(bal) {
        web3.toBigNumber(bal).should.eql(initialNumberOfTokens.add(-1e18)); 
        return helpers.waitForEvents(walletEvents, 1); // wait for events to come in
      })
      .then(function() {
        // Check wallet events for Transfer
        var confirmationEvent = _.find(walletEvents, function (event) {
          return event.event === 'Transfer';
        });
        confirmationEvent.args.from.should.eql(accounts[0]);  
        confirmationEvent.args.to.should.eql(accounts[1]);  
        confirmationEvent.args.value.should.eql( web3.toBigNumber(1e18) );  
      });
    });
  });
});

