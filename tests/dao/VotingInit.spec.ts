import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract } from "@ton-community/sandbox";
import { Address, Cell, ContractProvider } from "ton-core";
import { Voting } from "../../wrappers/Voting";
import '@ton-community/test-utils';
import { ActiveWallet, getRandomExp, getRandomInt, getRandomPayload, randomAddress } from "../utils";
import { JettonMinter } from "../../wrappers/JettonMinter";

let blockchain: Blockchain;
let jwallet_code:Cell;
let voting_code:Cell;
let keeper_code:Cell;
let master:ActiveWallet;
let userWallet:ActiveWallet;
let proposal:Cell;
let votingType:bigint;
let votingId:bigint;
let votingContract:(voting_id:bigint) => Promise<SandboxContract<Voting>>;

describe('Voting init unit tests', () => {
    beforeAll(async () => {
        votingId     = 0n;
        votingType   = 0n;
        voting_code  = await compile('Voting');
        jwallet_code = await compile('JettonWallet');
        keeper_code  = await compile('VoteKeeper');
        blockchain   = await Blockchain.create();
        master       = await blockchain.treasury('master');
        userWallet   = await blockchain.treasury('user1');
        proposal     = getRandomPayload();

        votingContract = async (voting_id:bigint) => await blockchain.openContract(
                              Voting.createFromConfig(
                                  {master: master.address, voting_id}, voting_code)

         );

    })


    it('Should deploy', async () => {
        const expirationDate = getRandomExp();
        const voting = await votingContract(votingId);

        const res = await voting.sendInitVoteMessage(master.getSender(),
                                                     expirationDate,
                                                     votingType,
                                                     jwallet_code,
                                                     keeper_code,
                                                     proposal,
                                                     userWallet.address);
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            to: voting.address,
            success: true,
            deploy: true
        });
        expect(res.transactions).toHaveTransaction({
            from: voting.address,
            to: master.address,
            body: JettonMinter.createVotingInitiated(votingId, expirationDate, userWallet.address)

        });
        const votingData = await voting.getData();

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
                                                     jwallet_code,
                                                     keeper_code,
                                                     proposal,
                                                     userWallet.address);
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            to: voting.address,
            success: true,
            deploy: true
        });

        const votingBefore = await voting.getData();

        const delta = BigInt(getRandomInt(100, 200));
        res = await voting.sendInitVoteMessage(master.getSender(),
                                               expirationDate + delta,
                                               votingType + delta,
                                               jwallet_code,
                                               keeper_code,
                                               proposal,
                                               userWallet.address);
        
        expect(res.transactions).toHaveTransaction({
            from: master.address,
            to: voting.address,
            success: false,
            exitCode: 0xf3
        });
        expect(res.transactions).not.toHaveTransaction({
            from: voting.address,
            to: userWallet.address,
            body: JettonMinter.createVotingInitiated(votingId, expirationDate, userWallet.address)
        });
        votingId++;
 
        
        const votingAfter = await voting.getData();
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
                                                     jwallet_code,
                                                     keeper_code,
                                                     proposal,
                                                     userWallet.address);
 
        expect(res.transactions).toHaveTransaction({
            from: userWallet.address,
            to: voting.address,
            success: false,
            exitCode:0xf4
        });
        expect(res.transactions).not.toHaveTransaction({
            from: voting.address,
            to: userWallet.address,
            body: JettonMinter.createVotingInitiated(votingId, expirationDate, userWallet.address)

        });
 
    });
});
