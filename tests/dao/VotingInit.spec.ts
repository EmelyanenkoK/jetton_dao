import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract } from "@ton-community/sandbox";
import { Address, Cell, ContractProvider } from "ton-core";
import { Voting } from "../../wrappers/Voting";
import '@ton-community/test-utils';
import { ActiveWallet, getRandomExp, getRandomInt, getRandomPayload, randomAddress } from "../utils";
import { VotingTests } from "../../wrappers/VotingTests";
import { JettonMinterTests } from "../../wrappers/JettonMinterTests";
import { Op } from "../../Ops";
import { Errors } from "../../Errors";

let blockchain: Blockchain;
let jwallet_code:Cell;
let voting_code:Cell;
let master:ActiveWallet;
let userWallet:ActiveWallet;
let proposal:Cell;
let votingType:bigint;
let votingId:bigint;
let votingContract:(voting_id:bigint) => Promise<SandboxContract<VotingTests>>;

describe('Voting init unit tests', () => {
    beforeAll(async () => {
        votingId     = 0n;
        votingType   = 0n;
        voting_code  = await compile('Voting');
        jwallet_code = await compile('JettonWallet');
        blockchain   = await Blockchain.create();
        master       = await blockchain.treasury('master');
        userWallet   = await blockchain.treasury('user1');
        proposal     = getRandomPayload();

        votingContract = async (voting_id:bigint) => await blockchain.openContract(
                              VotingTests.createFromConfig(
                                  {master: master.address, voting_id}, voting_code)

         );

    })


    it('Should deploy', async () => {
        const expirationDate = getRandomExp();
        const voting = await votingContract(votingId);

        const res = await voting.sendInitVoteMessage(master.getSender(),
                                                     expirationDate,
                                                     votingType,
                                                     proposal,
                                                     userWallet.address);
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            on: voting.address,
            success: true,
            deploy: true
        });
        expect(res.transactions).toHaveTransaction({
            from: voting.address,
            on: master.address,
            body: JettonMinterTests.createSimpleMsgVotingInitiated(votingId, expirationDate, userWallet.address)

        });
        const votingData = await voting.getFullData();

        expect(votingData.init).toEqual(true);
        expect(votingData.votingId).toEqual(votingId);
        expect(votingData.daoAddress.equals(master.address)).toBeTruthy();
        expect(votingData.proposal.equals(proposal)).toBeTruthy();
        expect(votingData.executed).toBe(false);
        expect(votingData.expirationDate).toEqual(expirationDate);
        expect(votingData.initiator.equals(userWallet.address)).toBeTruthy();
        expect(votingData.votedFor).toEqual(0n);
        expect(votingData.votedAgainst).toEqual(0n);
        votingId++;
    });

    it('Should not allow second initialization', async () => {
        const expirationDate = getRandomExp();
        const voting = await votingContract(votingId);

        let   res = await voting.sendInitVoteMessage(master.getSender(),
                                                     expirationDate,
                                                     votingType,
                                                     proposal,
                                                     userWallet.address);
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            on: voting.address,
            success: true,
            deploy: true
        });

        const votingBefore = await voting.getFullData();

        const delta = BigInt(getRandomInt(100, 200));
        res = await voting.sendInitVoteMessage(master.getSender(),
                                               expirationDate + delta,
                                               votingType + delta,
                                               proposal,
                                               userWallet.address);
        
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            on: voting.address,
            success: false,
            exitCode: Errors.voting.already_inited
        });
        expect(res.transactions).not.toHaveTransaction({
            from: voting.address,
            on: userWallet.address,
            body: JettonMinterTests.createSimpleMsgVotingInitiated(votingId, expirationDate, userWallet.address)
        });
        votingId++;
 
        
        const votingAfter = await voting.getFullData();
        // Should not change
        expect(votingBefore.votingType).toEqual(votingAfter.votingType);
        expect(votingBefore.expirationDate).toEqual(votingAfter.expirationDate);
        
    });

    it('Should allow vote init only from minter address', async() => {

        const expirationDate = getRandomExp();
        const voting = await votingContract(votingId);

        let   res = await voting.sendInitVoteMessage(userWallet.getSender(),
                                                     expirationDate,
                                                     votingType,
                                                     proposal,
                                                     userWallet.address);
 
        expect(res.transactions).toHaveTransaction({
            from: userWallet.address,
            on: voting.address,
            success: false,
            exitCode:Errors.voting.unauthorized_init
        });
        expect(res.transactions).not.toHaveTransaction({
            from: voting.address,
            on: userWallet.address,
            body: JettonMinterTests.createSimpleMsgVotingInitiated(votingId, expirationDate, userWallet.address)

        });
 
    });
});
