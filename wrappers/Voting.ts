import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';


export type VotingConfig = {master: Address, voting_id:bigint};
export class Voting implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static votingConfigToCell(conf:VotingConfig) {
        return beginCell().storeBit(false).storeAddress(conf.master).storeUint(conf.voting_id, 64).endCell();
    }
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

    static createFromConfig(conf:VotingConfig, code:Cell, workchain = 0) {
        const data = Voting.votingConfigToCell(conf);
        const init = {code, data};
        return new Voting(contractAddress(workchain, init), init);
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

    static initVoteMessage(expiration_date:bigint,
                            voting_type:bigint,
                            wallet_code:Cell,
                            keeper_code:Cell,
                            proposal:Cell,
                            initiator:Address,
                            query_id:bigint = 0n) {
        return beginCell().storeUint(0x182d8ddd,32)
                          .storeUint(query_id, 64)
                          .storeUint(expiration_date, 48)
                          .storeUint(voting_type, 64)
                          .storeRef(wallet_code)
                          .storeRef(keeper_code)
                          .storeRef(proposal)
                          .storeAddress(initiator)
              .endCell();
    }

    async sendInitVoteMessage(provider:ContractProvider,
                              via:Sender,
                              expiration_date:bigint,
                              voting_type:bigint,
                              wallet_code:Cell,
                              keeper_code:Cell,
                              proposal:Cell,
                              initiator:Address,
                              value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body:Voting.initVoteMessage(expiration_date,
                                        voting_type,
                                        wallet_code,
                                        keeper_code,
                                        proposal,
                                        initiator)
        });
    }
    static submitVotesMessage(voter:Address,
                              expiration_date:bigint,
                              votes:bigint,
                              vote_for:boolean,
                              confirm_vote:boolean = false,
                              query_id:bigint = 0n) {

        return beginCell().storeUint(0x6edb1889, 32)
                          .storeUint(query_id, 64)
                          .storeAddress(voter)
                          .storeUint(expiration_date, 48)
                          .storeCoins(votes)
                          .storeBit(vote_for)
                          .storeBit(confirm_vote)
               .endCell();
    }

    async sendSubmitVote(provider:ContractProvider,
                         via:Sender,
                         voter:Address,
                         expiration_date:bigint,
                         votes:bigint,
                         vote_for:boolean,
                         confirm_vote:boolean = false,
                         value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Voting.submitVotesMessage(voter, expiration_date, votes, vote_for, confirm_vote),
            value
        });
    }
    static endVotingMessage(query_id:bigint = 0n) {
        return beginCell().storeUint(0x66173a45, 32).storeUint(query_id, 64).endCell();
    }

    async sendEndVoting(provider: ContractProvider, via: Sender, value:bigint=toNano('0.5')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: Voting.endVotingMessage(),
            value
        });
    }

}
