import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class Voting implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Voting(address);
    }

/*
(init, dao_address, voting_id, expiration_date, voting_type,
            proposal, wallet_code,
            voted_for, voted_against,
            executed, initiator);
*/
    async getData(provider: ContractProvider) {
        let res = await provider.get('get_voting_data', []);
        let init = res.stack.readBoolean();
        let daoAddress = res.stack.readAddress();
        let votingId = res.stack.readBigNumber();
        let expirationDate = res.stack.readBigNumber();
        let votingType = res.stack.readBigNumber();
        let proposal = res.stack.readCell();
        let walletCode = res.stack.readCell();
        let votedFor = res.stack.readBigNumber();
        let votedAgainst = res.stack.readBigNumber();
        let executed = res.stack.readBoolean();
        let initiator = res.stack.readAddress();
        return {
            init,
            daoAddress,
            votingId,
            expirationDate,
            votingType,
            proposal,
            walletCode,
            votedFor,
            votedAgainst,
            executed,
            initiator,
        };
    }

    static endVotingMessage() {
        return beginCell().storeUint(0x66173a45, 32).storeUint(0, 64).endCell();
    }

    async sendEndVoting(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Voting.endVotingMessage(),
            value
        });
    }

}
