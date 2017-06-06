# FYNTokens

This repository reflects the current state of development of our FYN ICO token contracts

The companies on our alpha site, http://demo.fundyourselfnow.com, will have the same well-audited, battle tested wallet code, but the tokens will be enhanced. The code will be published after the fundraiser ends.

# Security

The code incorporates the crowdfunding logic into two distinct contracts:

Wallet.sol - Ethers will be sent to a 2-of-3 Multisig wallet derived from Parity's multisig wallet which is modified to accept ETH, and calls the Token contract to mint tokens. Being security critical, we adapted the code from previous proven ICOs to have the greatest assurance 

Token.sol  - The Token itself will be a base ERC20 logic, with security and locking logic built in, and will be enhanced along the way as we ensure the security of the contract. In the unlikely event of a breach in Token logic, we will trigger an emergency stop, correct the issue and state as necessary, and relaunch the token with the correct FYN values for every FYN holder.

Code Audit is currently being conducted by New Alchemy. 
Audit process will be updated on: https://dev.fundyourselfnow.com/ico/public/contract

Prealpha and Alpha addresses have been killed, please don't use them.

Beta Crowdsale Address: 0xBbCB7a2B58c1d0d6F3966d8b000F0A1a6fFe187a

To watch the token:
Beta Token     Address: 0x76C85632c4Ca0E88b3f83998394019B3C82a68bd

Current Beta Crowdsale is in crowdsale mode and has no transfer lock; the final will have a transfer lock that unlocks at the end of the crowdsale.
Final addresses to be released on 13/June/2017. 
