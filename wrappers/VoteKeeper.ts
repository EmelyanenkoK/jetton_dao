import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class VoteKeeper implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new VoteKeeper(address);
    }

    static requestVoteMessage(voter: Address,
                              expiration_date: bigint,
                              weight: bigint,
                              vote_for: boolean,
                              vote_confirmation: boolean,
                              query_id: bigint = 0n) {
        return beginCell().storeUint(0x2bd63704, 32)
                          .storeUint(query_id, 64)
                          .storeAddress(voter)
                          .storeUint(expiration_date, 48)
                          .storeCoins(weight)
                          .storeBit(vote_for)
                          .storeBit(vote_confirmation)
               .endCell();
    }

    async sendRequestVote(provider: ContractProvider, via: Sender,
                          voter: Address,
                          expiration_date:bigint,
                          weight: bigint,
                          vote_for:boolean,
                          vote_confirmation:boolean,
                          value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body: VoteKeeper.requestVoteMessage(voter,
                                                expiration_date,
                                                weight,
                                                vote_for,
                                                vote_confirmation)
        });
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
