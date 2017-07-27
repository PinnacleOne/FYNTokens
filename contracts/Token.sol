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

contract Token is ERC20, safeMath {

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
      require (msg.sender == walletAddress);
      _;
  }

  // Check if transfer should stop
  modifier checkTransferStop {
      require (transferStop != true);
      _;
  }


  /**
   *
   * Fix for the ERC20 short address attack
   *
   * http://vessenes.com/the-erc20-short-address-attack-explained/
   */

  modifier onlyPayloadSize(uint size) {
     require ((msg.data.length == size + 4));
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

    require (to != walletAddress); // Reject transfers to wallet (wallet cannot interact with token contract)
    require ( _balances[msg.sender] >= value );
    require ( safeToAdd(_balances[to], value) );

    _balances[msg.sender] -= value;
    _balances[to] += value;
    Transfer( msg.sender, to, value );
    return true;
  }

  function transferFrom( address from, address to, uint value)
    checkTransferStop
    returns (bool ok) {

    require (to != walletAddress) ; // Reject transfers to wallet (wallet cannot interact with token contract)

    // require enough balance
    require ( _balances[from] >= value );
    // require approval
    require ( _approvals[from][msg.sender] < value );

    require ( !safeToAdd(_balances[to], value) );

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


    require ((value==0) && (_approvals[msg.sender][spender] ==0));

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
        require (safeToMultiply(currentSwapRate(), etherAmount));
        uint tokensAmount = currentSwapRate() * etherAmount;

        require (safeToAdd(_balances[newTokenHolder],tokensAmount ));
        require (safeToAdd(_supply,tokensAmount));

        require ((_supply + tokensAmount) <= tokenCap);

        _balances[newTokenHolder] += tokensAmount;
        _supply += tokensAmount;

        TokenMint(newTokenHolder, tokensAmount);
  }

  function mintReserve(address beneficiary)
    external
    onlyFromWallet {
        require (tokenCap > _supply);
        require (safeToSub(tokenCap,_supply));
        uint tokensAmount = tokenCap - _supply;

        require (safeToAdd(_balances[beneficiary], tokensAmount ));
        require (safeToAdd(_supply,tokensAmount));

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


  function clearBalance (address _addr)
    external
    onlyFromWallet {
        _balances[_addr] = 0;
  }

  // Once activated, a new token contract will need to be created, mirroring the current token holdings.
  function stopToken() onlyFromWallet {
    transferStop = true;
    EmergencyStopActivated();
  }
}
