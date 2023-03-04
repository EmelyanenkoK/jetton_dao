import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class VoteKeeper implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Voting(address);
    }

/*
(voter_wallet, voting, votes)
*/
    async getData(provider: ContractProvider) {
        let res = await provider.get('get_vote_keeper_data', []);
        let voter_wallet = res.stack.readAddress();
        let voting = res.stack.readAddress();
        let votes = res.stack.readBigNumber();
        return {
            voter_wallet, voting, votes
        };
    }

}
