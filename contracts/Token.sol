pragma solidity ^0.4.0;
/*
This FYN token contract is derived from the vSlice ICO contract, based on the ERC20 token contract. 
Additional functionality has been integrated:
* the function mintTokens(), which makes use of the currentSwapRate() and safeToAdd() helpers
* the function stopToken(uint256 stopKey), which in an emergency, will trigger a complete and irrecoverable shutdown of the token
* Contract tokens are locked when created, and no tokens including pre-mine can be moved until the crowdsale is over.
*/

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

contract Token is ERC20 {

  mapping( address => uint ) _balances;
  mapping( address => mapping( address => uint ) ) _approvals;
  uint _supply;
  address public walletAddress;
  bool transferStop;
  uint256 public creationTime;

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
     if !(msg.data.length == size + 4) throw;
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

  // A helper to notify if overflow occurs
  function safeToAdd(uint a, uint b) private constant returns (bool) {
    return (a + b >= a && a + b >= b);
  }
  
  // A helper to notify if overflow occurs for multiplication
  function safeToMultiply(uint _a, uint _b) private constant returns (bool) {
    return (_b == 0 || ((_a * _b) / _b) == _a);
  }

  function transfer( address to, uint value)
    checkTransferStop
    onlyPayloadSize(2 * 32)
    returns (bool ok) {

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
      if (creationTime + 4 weeks > now) {
          return 120;
      }
      else if (creationTime + 8 weeks + 3 days + 3 hours > now) {
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

        _balances[newTokenHolder] += tokensAmount;
        _supply += tokensAmount;

        TokenMint(newTokenHolder, tokensAmount);
  }

  // The function disableTokenSwapLock() is called by the wallet
  // contract once the token swap has reached its end conditions
  function disableTokenSwapLock()
    external
    onlyFromWallet {
        transferStop = false;
        TokenSwapOver();
  }

  // Token can only be stopped with a secret 256-bits key, as an emergency precaution.
  // This is a last resort, irreversible action.
  // Once activated, a new token contract will need to be created, mirroring the current token holdings.
  function stopToken(uint256 preimage) {
    if (sha3(preimage) == 0x7b3fd1d8651e004db37810765677debafacf72152495c08e2b4aa7fad6552300) {
      transferStop = true;
      EmergencyStopActivated();
    }      
  }
}
