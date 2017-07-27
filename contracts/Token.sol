pragma solidity ^0.4.11;
/*
This FYN token contract is derived from the vSlice ICO contract, based on the ERC20 token contract.
Additional functionality has been integrated:
* the function mintTokens() only callable from wallet, which makes use of the currentSwapRate() and safeToAdd() helpers
* the function mintReserve() only callable from wallet, which at the end of the crowdsale will allow the owners to claim the unsold tokens
* the function stopToken() only callable from wallet, which in an emergency, will trigger a complete and irrecoverable shutdown of the token
* Contract tokens are locked when created, and no tokens including pre-mine can be moved until the crowdsale is over.
*/

import "./SecureMath.sol";


// ERC20 Token Standard Interface
// https://github.com/ethereum/EIPs/issues/20
contract ERC20 {
    function totalSupply() constant returns (uint);
    function balanceOf(address who) constant returns (uint);
    function allowance(address owner, address spender) constant returns (uint);

    function transfer(address to, uint value) returns (bool ok);
    function transferFrom(address from, address to, uint value) returns (bool ok);
    function approve(address spender, uint value) returns (bool ok);

    event Transfer(address indexed from, address indexed to, uint value);
    event Approval(address indexed owner, address indexed spender, uint value);
}

contract Token is secureMath, ERC20 {

  string public constant name = "FundYourselfNow Token";
  string public constant symbol = "FYN";
  uint8 public constant decimals = 18;  // 18 is the most common number of decimal places
  uint256 public tokenCap = 12500000e18; // 12.5 million FYN cap

  address public walletAddress;
  uint256 public creationTime;
  bool public transferStop;

  mapping( address => uint ) _balances;
  mapping( address => mapping( address => uint ) ) _approvals;
  uint _supply;

  event TokenMint(address newTokenHolder, uint amountOfTokens);
  event TokenSwapOver();
  event EmergencyStopActivated();

  modifier onlyFromWallet {
      if (msg.sender != walletAddress) throw;
      _;
  }

  // Check if transfer should stop
  modifier checkTransferStop {
      if (transferStop == true) throw;
      _;
  }


  /**
   *
   * Fix for the ERC20 short address attack
   *
   * http://vessenes.com/the-erc20-short-address-attack-explained/
   */

  modifier onlyPayloadSize(uint size) {
     if (!(msg.data.length == size + 4)) throw;
     _;
   }

  function Token( uint initial_balance, address wallet, uint256 crowdsaleTime) {
    _balances[msg.sender] = initial_balance;
    _supply = initial_balance;
    walletAddress = wallet;
    creationTime = crowdsaleTime;
    transferStop = true;
  }

  function totalSupply() constant returns (uint supply) {
    return _supply;
  }

  function balanceOf( address who ) constant returns (uint value) {
    return _balances[who];
  }

  function allowance(address owner, address spender) constant returns (uint _allowance) {
    return _approvals[owner][spender];
  }

  function transfer( address to, uint value)
    checkTransferStop
    onlyPayloadSize(2 * 32)
    returns (bool ok) {

    if (to == walletAddress) throw; // Reject transfers to wallet (wallet cannot interact with token contract)
    if( _balances[msg.sender] < value ) {
        throw;
    }
    if( !safeToAdd(_balances[to], value) ) {
        throw;
    }

    _balances[msg.sender] -= value;
    _balances[to] += value;
    Transfer( msg.sender, to, value );
    return true;
  }

  function transferFrom( address from, address to, uint value)
    checkTransferStop
    returns (bool ok) {

    if (to == walletAddress) throw; // Reject transfers to wallet (wallet cannot interact with token contract)

    // if you don't have enough balance, throw
    if( _balances[from] < value ) {
        throw;
    }
    // if you don't have approval, throw
    if( _approvals[from][msg.sender] < value ) {
        throw;
    }
    if( !safeToAdd(_balances[to], value) ) {
        throw;
    }
    // transfer and return true
    _approvals[from][msg.sender] -= value;
    _balances[from] -= value;
    _balances[to] += value;
    Transfer( from, to, value );
    return true;
  }

  function approve(address spender, uint value)
    checkTransferStop
    returns (bool ok) {

    // To change the approve amount you first have to reduce the addresses`
    //  allowance to zero by calling `approve(_spender,0)` if it is not
    //  already 0 to mitigate the race condition described here:
    //  https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
    //
    // Note that this doesn't prevent attacks; the user will have to personally
    //  check to ensure that the token count has not changed, before issuing
    //  a new approval. Increment/decrement is not commonly spec-ed, and
    //  changing to a check-my-approvals-before-changing would require user
    //  to find out his current approval for spender and change expected
    //  behaviour for ERC20.


    if ((value!=0) && (_approvals[msg.sender][spender] !=0)) throw;

    _approvals[msg.sender][spender] = value;
    Approval( msg.sender, spender, value );
    return true;
  }

  // The function currentSwapRate() returns the current exchange rate
  // between FYN tokens and Ether during the token swap period
  function currentSwapRate() constant returns(uint) {
      uint presalePeriod = 3 days;
      if (creationTime + presalePeriod > now) {
          return 140;
      }
      else if (creationTime + presalePeriod + 3 weeks > now) {
          return 120;
      }
      else if (creationTime + presalePeriod + 6 weeks + 6 days + 3 hours + 1 days > now) {
          // 1 day buffer to allow one final transaction from anyone to close everything
          // otherwise wallet will receive ether but send 0 tokens
          // we cannot throw as we will lose the state change to start swappability of tokens
          return 100;
      }
      else {
          return 0;
      }
  }

  // The function mintTokens is only usable by the chosen wallet
  // contract to mint a number of tokens proportional to the
  // amount of ether sent to the wallet contract. The function
  // can only be called during the tokenswap period
  function mintTokens(address newTokenHolder, uint etherAmount)
    external
    onlyFromWallet {
        if (!safeToMultiply(currentSwapRate(), etherAmount)) throw;
        uint tokensAmount = currentSwapRate() * etherAmount;

        if(!safeToAdd(_balances[newTokenHolder],tokensAmount )) throw;
        if(!safeToAdd(_supply,tokensAmount)) throw;

        if ((_supply + tokensAmount) > tokenCap) throw;

        _balances[newTokenHolder] += tokensAmount;
        _supply += tokensAmount;

        TokenMint(newTokenHolder, tokensAmount);
  }

  function mintReserve(address beneficiary)
    external
    onlyFromWallet {
        if (tokenCap <= _supply) throw;
        if(!safeToSub(tokenCap,_supply)) throw;
        uint tokensAmount = tokenCap - _supply;

        if(!safeToAdd(_balances[beneficiary], tokensAmount )) throw;
        if(!safeToAdd(_supply,tokensAmount)) throw;

        _balances[beneficiary] += tokensAmount;
        _supply += tokensAmount;

        TokenMint(beneficiary, tokensAmount);
  }

  // The function disableTokenSwapLock() is called by the wallet
  // contract once the token swap has reached its end conditions
  function disableTokenSwapLock()
    external
    onlyFromWallet {
        transferStop = false;
        TokenSwapOver();
  }

  // Once activated, a new token contract will need to be created, mirroring the current token holdings.
  function stopToken() onlyFromWallet {
    transferStop = true;
    EmergencyStopActivated();
  }
}
