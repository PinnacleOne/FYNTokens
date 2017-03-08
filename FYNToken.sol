pragma solidity ^0.4.9;

contract owned {
    address public owner;

    function owned() {
        owner = msg.sender;
    }

    modifier onlyOwner {
        if (msg.sender != owner) throw;
        _;
    }

    function transferOwnership(address newOwner) onlyOwner {
       if (newOwner != address(0)) owner = newOwner;
    }
}

/*
 * Stoppable
 * Abstract contract that allows children to implement an
 * emergency stop mechanism.
 */

contract Stoppable is owned {
  bool public stopped;

  modifier stopInEmergency { if (!stopped) _; }
  modifier onlyInEmergency { if (stopped) _; }

  // called by the owner on emergency, triggers stopped state
  function emergencyStop() external onlyOwner {
    stopped = true;
  }

  // called by the owner on end of emergency, returns to normal state
  function release() external onlyOwner onlyInEmergency {
    stopped = false;
  }

}

contract tokenRecipient { function receiveApproval(address _from, uint256 _value, address _token, bytes _extraData); }

contract token {
    /* Public variables of the token */
    string public standard = 'Token 0.1';
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    /* This creates an array with all balances */
    mapping (address => uint256) public balanceOf;
    mapping (address => mapping (address => uint256)) public allowance;

    /* This generates a public event on the blockchain that will notify clients */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /* Initializes contract with initial supply tokens to the creator of the contract */
    function token(
        uint256 initialSupply,
        string tokenName,
        uint8 decimalUnits,
        string tokenSymbol
        ) 
    {
        balanceOf[this] = initialSupply;                    // Give the contract all initial tokens
        totalSupply = initialSupply;                        // Update total supply
        name = tokenName;                                   // Set the name for display purposes
        symbol = tokenSymbol;                               // Set the symbol for display purposes
        decimals = decimalUnits;                            // Amount of decimals for display purposes
    }

    /* Send coins */
    function transfer(address _to, uint256 _value) {
        if (balanceOf[msg.sender] < _value) throw;           // Check if the sender has enough
        if (balanceOf[_to] + _value < balanceOf[_to]) throw; // Check for overflows
        balanceOf[msg.sender] -= _value;                     // Subtract from the sender
        balanceOf[_to] += _value;                            // Add the same to the recipient
        Transfer(msg.sender, _to, _value);                   // Notify anyone listening that this transfer took place
    }

    /* Allow another contract to spend some tokens in your behalf */
    function approve(address _spender, uint256 _value)
        returns (bool success) {
        allowance[msg.sender][_spender] = _value;
        tokenRecipient spender = tokenRecipient(_spender);
        return true;
    }

    /* Approve and then comunicate the approved contract in a single tx */
    function approveAndCall(address _spender, uint256 _value, bytes _extraData)
        returns (bool success) {    
        tokenRecipient spender = tokenRecipient(_spender);
        if (approve(_spender, _value)) {
            spender.receiveApproval(msg.sender, _value, this, _extraData);
            return true;
        }
    }
}

contract MyFYNToken is owned, token, Stoppable {

    uint256 public sellTokenForWei;
    uint256 public totalSupply;
    uint256 public founderReserve; 
    mapping (address => bool) public frozenAccount;

    /* This generates a public event on the blockchain that will notify clients */
    event FrozenFunds(address target, bool frozen);
    event TokenBuyBack(address target, uint256 amount);
    event ExchangeTransfer(address from, address to, uint256 amount);

    /* Initializes contract with initial supply tokens to the creator of the contract */
    function MyAdvancedToken(
        uint256 initialSupply,
        string tokenName,
        uint8 decimalUnits,
        string tokenSymbol
    ) token (initialSupply, tokenName, decimalUnits, tokenSymbol) {
        balanceOf[this] = initialSupply;                         // Give the owner all initial tokens
        founderReserve = initialSupply * 0.2;                    // 20% reserved for founders
    }

    /* Send coins */
    function transfer(address _to, uint256 _value) stopInEmergency {
        if (frozenAccount[msg.sender]) throw;                     // Check if frozen
        if (balanceOf[msg.sender] < _value) throw;                // Check if the sender has enough
        if (balanceOf[_to] + _value < balanceOf[_to]) throw;      // Check for overflows
        if (_to == address(this)) {                               // Transfer to contract
            if (sellPrice > 0) {                                  // Check if selling is enabled
                balanceOf[this]       += _value;                  // adds the amount to contract's balance
                balanceOf[msg.sender] -= _value;                  // subtracts the amount from seller's balance
                if (!msg.sender.send(_value / sellTokenForWei)) { // sends ether to the seller. It's important
                    throw;                                        // to do this last to avoid recursion attacks
                } else {
                    TokenBuyBack(msg.sender, _value);             // executes an event reflecting on the change
                }
            } else {
                throw;                                            // Selling back to contract not enabled
            } 
        } else {                                                  // Normal Transfer
               balanceOf[msg.sender] -= _value;                   // Subtract from the sender
               balanceOf[_to]        += _value;                   // Add the same to the recipient
               Transfer(msg.sender, _to, _value) ;                // Notify anyone listening that this transfer took place
        }
    }

    /* A contract attempts to get the coins */
    function transferFrom(address _from, address _to, uint256 _value) stopInEmergency returns (bool success) {
        if (frozenAccount[_from]) throw;                      // Check if frozen            
        if (balanceOf[_from] < _value) throw;                 // Check if the sender has enough
        if (balanceOf[_to] + _value < balanceOf[_to]) throw;  // Check for overflows
        if (_value > allowance[_from][msg.sender]) throw;     // Check allowance
        balanceOf[_from] -= _value;                           // Subtract from the sender
        balanceOf[_to] += _value;                             // Add the same to the recipient
        allowance[_from][msg.sender] -= _value;               
        ExchangeTransfer(_from, _to, _value);
        return true;
    }

    function freezeAccount(address target, bool freeze) onlyOwner {
        frozenAccount[target] = freeze;
        FrozenFunds(target, freeze);
    }

    function setPrices(uint256 newSellPrice, uint256 newBuyPrice) onlyOwner {
        if (newSellPrice <= 100)             // Sell price should never exceed initial unbonused tokenPerWei
            sellTokenForWei = newSellPrice;
    }

    function withdrawEther(uint256 amount) onlyOwner {
        owner.send( amount );
        withdrewEther( amount );
    }

    function withdrawReserve(uint256 amount) onlyOwner {
        if (amount > balanceOf[this]) throw;                                 // If founders withdraw more than balance, reject
        if (initialSupply * 0.2 - founderReserve) + amount >                 // If founders will withdraw more than
           (initialSupply - balanceOf[this] - founderReserve) * 0.2) throw;  // 20% of tokens already sold, reject
        balanceOf[owner]       += amount;
        balanceOf[this]        -= amount;    
        withdrewReserve( amount );
    }

    function () payable StopInEmergency {
        if ((balanceOf[this] - msg.value * 120) * 5 > initalSupply * 4) // Avoid division. If purchase will still mean
            tokenPerWei = 120;                                          // less than 1/5 of token sold, 20% bonus applies
        else
            tokenPerWei = 100;         
        uint amount = msg.value * tokenPerWei;                          // calculates the amount
        if (balanceOf[this] < amount + founderReserve) throw;           // checks if it has enough to sell
        balanceOf[msg.sender]   += amount;                              // adds the amount to buyer's balance
        balanceOf[this]         -= amount;                              // subtracts amount from seller's balance
        Transfer(this, msg.sender, amount);                             // execute an event reflecting the change
    }

}
