pragma solidity ^0.4.11;

contract secureMath {
  // A helper to notify if overflow occurs for addition
  function safeToAdd(uint a, uint b) internal constant returns (bool) {
    return (a + b >= a && a + b >= b);
  }

  // A helper to notify if overflow occurs for multiplication
  function safeToMultiply(uint _a, uint _b) internal constant returns (bool) {
    return (_b == 0 || ((_a * _b) / _b) == _a);
  }

  // A helper to notify if underflow occurs for subtraction
  function safeToSub(uint a, uint b) internal constant returns (bool) {
    return (a >= b);
  }
}
