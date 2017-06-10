var abi = require('ethereumjs-abi');
var BN = require('bn.js');
var Promise = require('bluebird');

function rpc(method, arg) {
  var req = {
    jsonrpc: "2.0",
    method: method,
    id: new Date().getTime()
  };
  if (arg) req.params = arg;

  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync(req, (err, result) => {
      if (err) return reject(err)
      if (result && result.error) {
        return reject(new Error("RPC Error: " + (result.error.message || result.error)))
      }
      resolve(result)
    })
  })
}

web3.evm = web3.evm || {}
web3.evm.increaseTime = function (time) {
  return rpc('evm_increaseTime', [time])
}
web3.evm.mine = function() {
  return rpc('evm_mine')
}
web3.evm.snapshot = function() {
  return rpc('evm_snapshot')
}
web3.evm.revert = function(snapshot_id) {
  return rpc('evm_revert', [snapshot_id])
}

exports.showBalances = function() {
  var accounts = web3.eth.accounts;
  for (var i=0; i<accounts.length; i++) {
    console.log(accounts[i] + ": " + web3.fromWei(web3.eth.getBalance(accounts[i]), 'ether'), 'ether' );
  }
};

// Polls an array for changes
exports.waitForEvents = function(eventsArray, numEvents) {
  if (numEvents === 0) {
    return Promise.delay(1000); // Wait a reasonable amount so the caller can know no events fired
  }
  var numEvents = numEvents || 1;
  var oldLength = eventsArray.length;
  var numTries = 0;
  var pollForEvents = function() {
    numTries++;
    if (eventsArray.length >= (oldLength + numEvents)) {
      return;
    }
    if (numTries >= 100) {
      if (eventsArray.length == 0) {
        console.log('Timed out waiting for events!');
      }
      return;
    }
    return Promise.delay(100)
    .then(pollForEvents);
  };
  return pollForEvents();
};

// Helper to get sha3 for solidity tightly-packed arguments
exports.getSha3ForConfirmationTx = function(toAddress, amount, data, expireTime, sequenceId) {
  return abi.soliditySHA3(
    [ "address", "uint", "string", "uint", "uint" ],
    [ new BN(toAddress.replace("0x", ""), 16), web3.toWei(amount, "ether"), data, expireTime, sequenceId ]
  ).toString('hex');
};

exports.checkIfThrown = function(error) {
  if(error.toString().indexOf("invalid opcode") != -1) {
    //console.log("We were expecting a Solidity throw (aka an invalid JUMP), we got one. Test succeeded.");
  } else {
    // if the error is something else (e.g., the assert from previous promise), then we fail the test
    assert(false, error.toString());
  }
}
