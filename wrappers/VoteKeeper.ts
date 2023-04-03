import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class VoteKeeper implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new VoteKeeper(address);
    }
/*
(voter_wallet, voting, votes)
*/
    async getData(provider: ContractProvider) {
        let res = await provider.get('get_vote_keeper_data', []);
        let voter_wallet = res.stack.readAddress();
        let voting = res.stack.readAddress();
        let votesFor = res.stack.readBigNumber();
        let votesAgainst = res.stack.readBigNumber();
        let totalVotes = votesFor + votesAgainst;
        return {
            voter_wallet, voting, totalVotes, votesFor, votesAgainst
        };
    }

}
