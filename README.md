# FYNTokens

This repository reflects the current state of development of our FYN ICO token contracts

# Security

The code incorporates the crowdfunding logic into two distinct contracts:

Wallet.sol - Ethers will be sent to a 2-of-3 Multisig wallet derived from Parity's multisig wallet which is modified to accept ETH, and calls the Token contract to mint tokens. Being security critical, we adapted the code from previous proven ICOs to have the greatest assurance 

Token.sol  - The Token itself will be a base ERC20 logic, with security and locking logic built in, and will be enhanced along the way as we ensure the security of the contract. In the unlikely event of a breach in Token logic, we will trigger an emergency stop, correct the issue and state as necessary, and relaunch the token with the correct FYN values for every FYN holder.

Code Audit is currently being conducted by New Alchemy. A draft audit has been completed with no critical issues found and final code audit results is expected by 23/6/2017

Audit process will be updated on: https://www.fundyourselfnow.com/ico/public/contract

Crowdsale Address: 0xb1021477444c6566509e1b80d2c99e9603a31c47 (Contract source verified on Etherscan)

Token     Address: 0x88fcfbc22c6d3dbaa25af478c578978339bde77a (Contract source verified on Etherscan)

We are currently having a crowdsale and the FYN token will have a transfer lock that unlocks at the end of the crowdsale (31th July 5pm UTC+8), or when the token sale is sold out.
