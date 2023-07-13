# Jetton based DAO

This contract system implements Jetton with ability to vote. Jetton Master (minter) serves as DAO.
 
- Anybody can mint new Voting Proposal with some expiration date through DAO.
- Any jetton owner can vote for proposal through wallet using whole (locked and unlocked) balance.
- Voted jettons are locked (can not be transferred) on wallet till expiration_date
- Voted jettons can be used for voting for another proposal.
- Not voted jettons (in particularly jettons received after vote) can be transferred
- Not voted jettons can be used for voting in already voted proposal
- Voted jettons are not shown in balance (that way common wallet will suggest transfer)
- Double voting is prohibited through VoteKeeper: contract which sits between jetton wallet and voting proposal
- Expiration date is provided during voting, Voting Proposal rejects votes with inappropriate expiration date

## Configuration
1. Voting rules: adjust `is_proposal_accepted` in jetton-minter.func
2. Jetton description: change content in scripts/deployMinter


# Acknowledgments
This DAO is based on ideas of [Nikita Kuznetsov](https://github.com/KuznetsovNikita), developer of [OpenMask](https://github.com/OpenProduct/openmask-extension). 
In particular:
- Expiration date based limitation of jetton transfers. Alternatively, to prevent double voting, jettons can have a [flavour/version](https://github.com/ton-blockchain/TIPs/issues/74#issuecomment-1113132709) which depends on votings these jettons participated and complex mixing rules.
- *Voting Proposal checks expiration date* flow. Alternatively, to authorize expiration_date, it is possible to make expiration data a part of voting proposal init state and make checks of expiration date on wallet.
- *VoteKeeper* way to prohibit multiple votes from one wallet. Alternatively, list of already made votes can be stored in wallet in dictionary (it is not that bad in this case, since this dictionary is in sole control of wallet owner).

## Executor
Currently, DAO decisions are executed directly from DAO account which coincides with DAO jetton root.
This causes difficulties of isolation internal DAO logic from DAO decisions (see [decision filter](./contracts/dao-decisions-filter.func)).
Another possible solution for this issue is DAO Executor: special contract that upon request from DAO root sends desired message on behalf of DAO.
This idea was suggested by [akifoq](https://github.com/akifoq). It is not implemented yet, though,
since on the one hand it is still a good idea for DAO to have decision filter, and on the other
addition chain link in DAO decision execution is undesired.