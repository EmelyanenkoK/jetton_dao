import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';
import { VoteKeeper } from './VoteKeeper';
export class VoteKeeperTests extends VoteKeeper {

    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }

    static createFromAddress(address: Address) {
        return new VoteKeeperTests(address);
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
            body: VoteKeeperTests.requestVoteMessage(voter,
                                                expiration_date,
                                                weight,
                                                vote_for,
                                                vote_confirmation)
        });
    }
}
