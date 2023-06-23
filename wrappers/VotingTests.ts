import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from 'ton-core';
import { Voting, VotingConfig } from './Voting';
import { Op } from '../Ops';

export class VotingTests extends Voting {

    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
        super(address, init);
    }

    static createFromAddress(address: Address) {
        return new VotingTests(address);
    }

    static createFromConfig(conf:VotingConfig, code:Cell, workchain = 0) {
        const data = Voting.votingConfigToCell(conf);
        const init = {code, data};
        return new VotingTests(contractAddress(workchain, init), init);
    }

    static initVoteMessage(expiration_date:bigint,
                            voting_type:bigint,
                            proposal:Cell,
                            initiator:Address,
                            query_id:bigint = 0n) {
        return beginCell().storeUint(Op.voting.init_voting,32)
                          .storeUint(query_id, 64)
                          .storeUint(expiration_date, 48)
                          .storeUint(voting_type, 64)
                          .storeRef(proposal)
                          .storeAddress(initiator)
              .endCell();
    }

    async sendInitVoteMessage(provider:ContractProvider,
                              via:Sender,
                              expiration_date:bigint,
                              voting_type:bigint,
                              proposal:Cell,
                              initiator:Address,
                              value:bigint = toNano('0.1')) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            value,
            body:VotingTests.initVoteMessage(expiration_date,
                                             voting_type,
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

        return beginCell().storeUint(Op.voting.submit_votes, 32)
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
            body: VotingTests.submitVotesMessage(voter, expiration_date, votes, vote_for, confirm_vote),
            value
        });
    }
}
