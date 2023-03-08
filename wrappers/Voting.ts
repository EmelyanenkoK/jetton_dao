import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';

export class Voting implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new Voting(address);
    }
/*
    return (init, executed,
            dao_address, initiator,
            voting_id, expiration_date, voting_type,
            ;; proposal
            minimal_execution_amount, message, description,
            voted_for, voted_against);
*/
    async getData(provider: ContractProvider) {
        let res = await provider.get('get_voting_data', []);
        console.log(res.stack);
        let init = res.stack.readBoolean();
        let executed = res.stack.readBoolean();
        let daoAddress = res.stack.readAddress();
        let initiator = res.stack.readAddress();
        let votingId = res.stack.readBigNumber();
        let expirationDate = res.stack.readBigNumber();
        let votingType = res.stack.readBigNumber();
        let minAmount = res.stack.readBigNumber();
        let message = res.stack.readCellOpt();
        let description = res.stack.readString();
        let votedFor = res.stack.readBigNumber();
        let votedAgainst = res.stack.readBigNumber();
        return {
            init, executed,
            daoAddress, initiator,
            votingId, expirationDate, votingType,
            minAmount, message, description,
            votedFor, votedAgainst,
        };
    }
/*
(init, dao_address, voting_id, expiration_date, voting_type,
            proposal, wallet_code,
            voted_for, voted_against,
            executed, initiator);
*/
    async getFullData(provider: ContractProvider) {
        let res = await provider.get('get_full_voting_data', []);
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

}
