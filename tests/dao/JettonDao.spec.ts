import { Blockchain, SandboxContract, TreasuryContract, Verbosity, internal, BlockchainSnapshot } from '@ton-community/sandbox';
import { Cell, toNano, fromNano, beginCell, storeMessageRelaxed, Address, SendMode, OpenedContract, AccountStorage, Dictionary } from 'ton-core';
import { JettonWallet } from '../../wrappers/JettonWallet';
import { JettonMinter } from '../../wrappers/JettonMinter';
import { JettonMinterTests } from '../../wrappers/JettonMinterTests';
import { Voting } from '../../wrappers/Voting';
import { VotingResults } from '../../wrappers/VotingResults';
import { VoteKeeper } from '../../wrappers/VoteKeeper';
import '@ton-community/test-utils';
import { compile } from '@ton-community/blueprint';
import { differentAddress, getRandom, getRandomDuration, getRandomExp, getRandomInt, getRandomPayload, getRandomTon, voteCtx, ActiveWallet, ActiveJettonWallet, pickWinnerResult, sortBalanceResult } from "../utils";
import { VotingTests } from '../../wrappers/VotingTests';
import { VoteKeeperTests } from '../../wrappers/VoteKeeperTests';
import { Op } from '../../Ops';
import { Errors } from '../../Errors';
import { readFileSync, writeFileSync } from 'fs';


describe('DAO integrational', () => {
    jest.setTimeout(15000);
    let minter_code = new Cell();
    let voting_code = new Cell();
    let minter_update = new Cell();
    let voting_results_code = new Cell();
    let blockchain: Blockchain;
    let user1:ActiveWallet;
    let user2:ActiveWallet;
    let user3:ActiveWallet;
    let initialUser1Balance:bigint;
    let initialUser2Balance:bigint;
    let initialUser3Balance:bigint;
    let votes:voteCtx[] = []; // Array index is voting index
    let genMessage:(to:Address, body:Cell, value?:bigint) => Cell;
    let sortBalance:(w1:ActiveJettonWallet, w2:ActiveJettonWallet) => Promise<sortBalanceResult>;
    let pickWinner:(u1:ActiveWallet, u2:ActiveWallet) => Promise<pickWinnerResult>;
    let DAO:SandboxContract<JettonMinter>;
    let testDAO:SandboxContract<JettonMinterTests>;
    let userWallet:(address:Address) => Promise<ActiveJettonWallet>;
    let votingContract:(voting_id:bigint) => Promise<SandboxContract<Voting>>;
    let resultsContract:(duration:number, votingBody:Cell) => Promise<SandboxContract<VotingResults>>;
    let testVotingContract:(voting_id:bigint) => Promise<SandboxContract<VotingTests>>;
    let voteKeeperContract:(wallet:ActiveJettonWallet, voting_addr:Address) => Promise<SandboxContract<VoteKeeper>>;
    let testKeeperContract:(wallet:ActiveJettonWallet, voting_addr:Address) => Promise<SandboxContract<VoteKeeperTests>>;
    let defaultContent:Cell;
    let expirationDate:bigint;
    let assertKeeper:(vAddr:Address, wallet:ActiveJettonWallet, votes:bigint) => void;
    let votingId:bigint;
    let defaultVotingType = 0n;

    beforeAll(async () => {
        minter_code = await compile('JettonMinter');
        voting_code = await compile('Voting');
        minter_update    = await compile('MinterUpdate');
        voting_results_code = await compile('VotingResults');
        let jwallet_code    = await compile('JettonWallet');
        blockchain = await Blockchain.create();

        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${jwallet_code.hash().toString('hex')}`), jwallet_code);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;

        user1 = await blockchain.treasury('user1');
        user2 = await blockchain.treasury('user2');
        user3 = await blockchain.treasury('user3');
        initialUser1Balance = getRandomTon(100, 1000);
        initialUser2Balance = getRandomTon(100, 1000);
        initialUser3Balance = getRandomTon(100, 1000);
        defaultContent = beginCell().endCell();
        votingId = 0n;
        DAO = blockchain.openContract(
                   JettonMinter.createFromConfig(
                     {
                       admin: user1.address,
                       content: defaultContent,
                       voting_code: voting_code,
                     },
                     minter_code));
        testDAO    = blockchain.openContract(JettonMinterTests.createFromAddress(DAO.address));
        userWallet = async (address:Address) => blockchain.openContract(
                          JettonWallet.createFromAddress(
                            await DAO.getWalletAddress(address)
                          )
                     );
        votingContract = async (voting_id:bigint) => blockchain.openContract(
                          Voting.createFromAddress(
                            await DAO.getVotingAddress(voting_id)
                          )
                     );
        resultsContract = async (duration:number, votingBody:Cell) => blockchain.openContract(
                          VotingResults.createFromConfig({
                              dao_address: DAO.address,
                              voting_duration: duration,
                              voting_body: votingBody,
                          }, voting_results_code)
                     );
        testVotingContract = async (voting_id:bigint) => blockchain.openContract(
                          VotingTests.createFromAddress(
                            await DAO.getVotingAddress(voting_id)
                          )
                     );
        voteKeeperContract = async (jw:ActiveJettonWallet, voting_addr:Address) => blockchain.openContract(
                          VoteKeeper.createFromAddress(
                            await jw.getVoteKeeperAddress(voting_addr)
                          )
                     );
        testKeeperContract = async (jw:ActiveJettonWallet, voting_addr:Address) => blockchain.openContract(
                          VoteKeeperTests.createFromAddress(
                            await jw.getVoteKeeperAddress(voting_addr)
                          )
                     );
        sortBalance = async (w1:ActiveJettonWallet, w2:ActiveJettonWallet) => {
            const balance1 = await w1.getTotalBalance();
            const balance2 = await w2.getTotalBalance();
            let sortRes:sortBalanceResult;

            if(balance1 >= balance2) {
                sortRes = {
                    min: w2,
                    max: w1,
                    maxBalance: balance1,
                    minBalance: balance2,
                    isEq: balance1 == balance2,
                    hasZero: balance2 == 0n
                };
            }
            else {
                sortRes = {
                    min: w1,
                    max: w2,
                    maxBalance: balance2,
                    minBalance: balance1,
                    isEq: false,
                    hasZero: balance1 == 0n
                };
            }

            return sortRes;
        };

        genMessage = (to:Address, body:Cell, value:bigint = 0n) => {
            return beginCell().store(storeMessageRelaxed(
                {
                    info: {
                        type: "internal",
                        bounce: true,
                        bounced: false,
                        ihrDisabled: true,
                        dest: to,
                        value: {coins: value},
                        ihrFee: 0n,
                        forwardFee: 0n,
                        createdLt: 0n,
                        createdAt:0
                    },
                    body

                }
            )).endCell();

        };

        pickWinner = async (u1: ActiveWallet, u2: ActiveWallet) => {
            const w1 = await userWallet(u1.address);
            const w2 = await userWallet(u2.address);
            let comp = await sortBalance(w1, w2);

            let res: pickWinnerResult;
            let winner: ActiveWallet;
            let loser: ActiveWallet;


           if(comp.max == w1) {
                winner = u1;
                loser  = u2;
           }
           else {
                winner = u2;
                loser  = u1;
           }


            const mintAmount = comp.isEq || comp.hasZero
                             ? getRandomTon(1, 10)
                             : 0n;
            /*
             * Now, since we have to carry state across all tests
             * we need to make sure that
             * 1) Balance of those jetton wallets differ
             * 2) None of those is 0
             * Otherwise can't vote successfully
             */
            // Meh

            if(comp.isEq) {
                // Topup the largest so balance is not equal
                await DAO.sendMint(user1.getSender(),
                                   winner.address,
                                   mintAmount,
                                   toNano('0.05'),
                                   toNano('1'));
                comp.maxBalance += mintAmount;
            }
            if(comp.hasZero) {
                // Topup lowest in case it's zero
                await DAO.sendMint(user1.getSender(),
                                   loser.address,
                                   mintAmount - 1n, // Make sure both have different balances
                                   toNano('0.05'),
                                   toNano('1'));

                comp.minBalance += mintAmount - 1n;
           }

           return {
               winner: {
                   user: winner,
                   jetton: comp.max,
                   balance: comp.maxBalance
               },
               loser: {
                   user: loser,
                   jetton: comp.min,
                   balance: comp.minBalance
               }
           };

        };

        assertKeeper = async (vAddr: Address, wallet:ActiveJettonWallet, expVotes:bigint) => {
            const keepR      = await voteKeeperContract(wallet, vAddr);
            const keeperData = await keepR.getData();

            expect(keeperData.voter_wallet.equals(wallet.address)).toBeTruthy();
            expect(keeperData.voting.equals(vAddr)).toBeTruthy();
            expect(keeperData.totalVotes).toEqual(expVotes);


   }

        await DAO.sendDeploy(user1.getSender(), toNano('1'));
        await DAO.sendMint(user1.getSender(), user1.address, initialUser1Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user2.address, initialUser2Balance, toNano('0.05'), toNano('1'));
        await DAO.sendMint(user1.getSender(), user3.address, initialUser3Balance, toNano('0.05'), toNano('1'));
    });
    it('should create new voting', async () => {
            expirationDate = getRandomExp();
            let voting = await votingContract(votingId);

            const randTon    = getRandomTon(1, 2000);
            const payload    = getRandomPayload();
            const minExec    = toNano('0.1');

            let createSimpleMsgVoting = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
                expirationDate,
                minExec, // minimal_execution_amount
                payload // payload
            );

            // Voting deploy message
            expect(createSimpleMsgVoting.transactions).toHaveTransaction({
                from: DAO.address,
                on: voting.address,
                deploy: true
            });

            // Voting initiated message to DAO
            expect(createSimpleMsgVoting.transactions).toHaveTransaction({
                from: voting.address,
                on: DAO.address,
                body: JettonMinterTests.createVotingInitiated(votingId, expirationDate, user1.address)
            });

            // Confirmation message
            expect(createSimpleMsgVoting.transactions).toHaveTransaction({ //notification
                        from: DAO.address,
                        on: user1.address,
                        body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
                                         .storeUint(0, 64) //query_id
                                         .storeAddress(voting.address) //voting_code
                                         .endCell()
                    });

            const votingData = await voting.getFullData();

            votes[0] = votingData;

            const proposal = Voting.createSendMsgProposalBody(minExec, payload);

            expect(votingData.votingId).toEqual(votingId);
            expect(votingData.daoAddress.equals(DAO.address)).toBeTruthy();
            expect(votingData.proposal.equals(proposal)).toBeTruthy();
            expect(votingData.executed).toBe(false);
            expect(votingData.expirationDate).toEqual(expirationDate);
            expect(votingData.initiator.equals(user1.address)).toBeTruthy();
            expect(votingData.init).toEqual(true);
            expect(votingData.votedFor).toEqual(0n);
            expect(votingData.votedAgainst).toEqual(0n);
            expect(votingData.votingType).toEqual(0n);
    });

    it('DAO should not allow voting initiated message from non-voting', async () =>{
        const voting   = await votingContract(votingId);

        let   res = await testDAO.sendVotingInitiated(user1.getSender(),
                                                      votingId,
                                                      expirationDate,
                                                      user1.address);
        expect(res.transactions).toHaveTransaction({
            from: user1.address,
            on: DAO.address,
            success: false,
            exitCode: Errors.minter.unauthorized_vote_execution
        });

        const voteSender = blockchain.sender(voting.address);

        res = await testDAO.sendVotingInitiated(voteSender,
                                                votingId + 1n, // Incorrect voting id
                                                expirationDate,
                                                user1.address);
                                            //
        // Voting with different id would get different address
        expect(res.transactions).toHaveTransaction({
            from: voting.address,
            on: DAO.address,
            success: false,
            exitCode: Errors.minter.unauthorized_vote_execution
        });

        res = await testDAO.sendVotingInitiated(voteSender,
                                                votingId, // Correct id
                                                expirationDate,
                                                user1.address);
        expect(res.transactions).toHaveTransaction({
            from: voting.address,
            on: DAO.address,
            success: true
        });

        expect(res.transactions).toHaveTransaction({
            from: DAO.address,
            on: user1.address,
            body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
                             .storeUint(0, 64) //query_id
                             .storeAddress(voting.address) //voting_code
                             .endCell()

        });

    });

    //it('jetton owner can vote for', async () => {
    //        let voting     = await votingContract(votingId);

    //        let votingCode = await DAO.getVotingCode();
    //        const user1JettonWallet = await userWallet(user1.address);
    //        const voteCtx  = votes[0];
    //        // let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        // Checking the whole vote chain
    //        const keepR = await voteKeeperContract(user1JettonWallet, voting.address);

    //        /*
    //        expect(voteResult.transactions).toHaveTransaction({
    //            from: user1.address,
    //            to: user1JettonWallet.address,
    //            body: JettonWallet.voteMessage(voting.address,
    //                                           expirationDate,
    //                                           true, false),
    //            success: true
                                               
    //        });
    //        expect(voteResult.transactions).toHaveTransaction({
    //            from: user1JettonWallet.address,
    //            to: keepR.address,
    //            body: VoteKeeper.requestVoteMessage(user1.address,
    //                                                expirationDate,
    //                                                initialUser1Balance,
    //                                                true, false),
    //            success: true
    //        });
    //        expect(voteResult.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            to: voting.address,
    //            body: Voting.submitVotesMessage(user1.address,
    //                                            expirationDate,
    //                                            initialUser1Balance,
    //                                            true, false),
    //            success: true
    //        });
    //        expect(voteResult.transactions).toHaveTransaction({ //notification
    //                    from: voting.address,
    //                    to: user1.address,
    //                    // excesses 0xd53276db, query_id
    //                    body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
    //                });
    //        */
    //        const res = await assertVoteChain(user1, user1JettonWallet,
    //                                          0n,
    //                                          initialUser1Balance,
    //                                          voting.address,
    //                                          expirationDate, true, false);

    //        voteCtx.votedFor += initialUser1Balance;

    //        assertKeeper(voting.address, user1JettonWallet, voteCtx.votedFor);

    //        const votingData = await voting.getData();

    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(initialUser1Balance);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(voteCtx.votedAgainst);


    //    });

    //    it('jetton owner can vote against', async () => {

    //        let voting     = await votingContract(votingId);
    //        let votingData = await voting.getData();
    //        let voteCtx    = votes[Number(votingId)];

    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

    //        const user3JettonWallet = await userWallet(user3.address);
    //        /*
    //        const voteRes           = await user3JettonWallet.sendVote(user3.getSender(), voting.address, expirationDate, false, false);


    //        expect(voteRes.transactions).toHaveTransaction({ //notification
    //                    from: voting.address,
    //                    on: user3.address,
    //                    // excesses 0xd53276db, query_id
    //                    body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
    //                });
    //        */
    //        const res = await assertVoteChain(user3, user3JettonWallet,
    //                                          0n,
    //                                          initialUser3Balance,
    //                                          voting.address,
    //                                          expirationDate, false, false);



    //        voteCtx.votedAgainst += initialUser3Balance;

    //        assertKeeper(voting.address, user3JettonWallet, voteCtx.votedAgainst);

    //        votingData     = await voting.getData();
    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

    //    });

    //    it('jetton owner can not transfer just after voting', async () => {
    //        const user1JettonWallet = await userWallet(user1.address);
    //        let transferResult = await user1JettonWallet.sendTransfer(user1.getSender(), toNano('0.1'), //tons
    //               1n, user1.address,
    //               user1.address, null, toNano('0.05'), null);
    //        expect(transferResult.transactions).toHaveTransaction({ //failed transfer
    //                    from: user1.address,
    //                    on: user1JettonWallet.address,
    //                    exitCode: Errors.wallet.not_enough_jettons //error::not_enough_jettons = 706;
    //                });
    //    });

    //    it('jetton owner can transfer tokens which did not vote', async () => {
    //        const user2JettonWallet = await userWallet(user2.address);
    //        const transferVal = getRandomTon(2, 10);
    //        await user2JettonWallet.sendTransfer(user2.getSender(), toNano('0.15'), //tons
    //               transferVal, user1.address,
    //               user1.address, null, toNano('0.05'), null);
    //        const user1JettonWallet = await userWallet(user1.address);
    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(transferVal);
    //        let transferResult = await user1JettonWallet.sendTransfer(user1.getSender(), toNano('0.15'), //tons
    //               1n, user2.address,
    //               user1.address, null, toNano('0.05'), null);
    //        expect(transferResult.transactions).not.toHaveTransaction({ //failed transfer
    //                    from: user1.address,
    //                    on: user1JettonWallet.address,
    //                    exitCode: Errors.wallet.not_enough_jettons //error::not_enough_jettons = 706;
    //                });
    //        expect(transferResult.transactions).toHaveTransaction({ // excesses
    //                    from: user2JettonWallet.address,
    //                    on: user1.address,
    //                    // excesses 0xd53276db, query_id
    //                    body: beginCell().storeUint(Op.excesses, 32).storeUint(0, 64).endCell()
    //                });
    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(transferVal - 1n);
    //    });

    //    it('jetton owner can vote second time but only with new jettons', async () => {
    //        let voting     = await votingContract(votingId);
    //        const voteCtx  = votes[Number(votingId)];
    //        let votingCode = await DAO.getVotingCode();
    //        const user1JettonWallet = await userWallet(user1.address);
    //        const walletData = await user1JettonWallet.getDaoData();
    //        // let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, false);
    //        const voteReult = await assertVoteChain(user1, user1JettonWallet,
    //                                                walletData.locked,
    //                                                walletData.balance,
    //                                                voting.address,
    //                                                expirationDate, false, false);



    //        /*
    //        expect(voteResult.transactions).toHaveTransaction({ //notification
    //                    from: voting.address,
    //                    on: user1.address,
    //                    // excesses 0xd53276db, query_id
    //                    body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
    //                });

    //        */
    //        voteCtx.votedAgainst += walletData.balance;

    //        assertKeeper(voting.address, user1JettonWallet, walletData.balance + walletData.locked);

    //        const votingData = await voting.getData();

    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
    //    });

    //it('jetton owner can vote in the other voting', async () => {
    //        let voting     = await votingContract(++votingId);
    //        expirationDate = renewExp(expirationDate);

    //        const createSimpleMsgVoting = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            beginCell().endCell() // payload
    //        );

    //        expect(createSimpleMsgVoting.transactions).toHaveTransaction({
    //            from: DAO.address,
    //            on: user1.address,
    //            body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
    //                                     .storeUint(0, 64) //query_id
    //                                     .storeAddress(voting.address) //voting_code
    //                                     .endCell()

    //        });
    //        let votingData = await voting.getData();

    //        expect(votingData.init).toEqual(true);
    //        expect(votingData.votedFor).toEqual(0n);
    //        expect(votingData.votedAgainst).toEqual(0n);

    //        const voteCtx  = votingData as voteCtx;
    //        votes[1]       = voteCtx;


    //        const user1JettonWallet = await userWallet(user1.address);
    //        const walletData        = await user1JettonWallet.getDaoData();
    //        // Locked balance from previous vote
    //        expect(walletData.locked).toBeGreaterThan(0n);
    //        const expectedVote      = walletData.balance + walletData.locked;
    //        //let voteResult = await assertVoteChain(user1, user1JettonWallet);
    //        /*
    //        let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);

    //        expect(voteResult.transactions).toHaveTransaction({ //notification
    //                    from: voting.address,
    //                    on: user1.address,
    //                    // excesses 0xd53276db, query_id
    //                    body: beginCell().storeUint(0xd53276db, 32).storeUint(0, 64).endCell()
    //                });

    //        */

    //        let voteResult = await assertVoteChain(user1, 
    //                                               user1JettonWallet,
    //                                               0n, // New vote so full balance should count in it
    //                                               expectedVote, 
    //                                               voting.address,
    //                                               expirationDate,
    //                                               true, false);
    //        voteCtx.votedFor += expectedVote;

    //        assertKeeper(voting.address, user1JettonWallet, voteCtx.votedFor);

    //        votingData = await voting.getData();

    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
    //    });


    //it('Should not be able to request vote confirmation from non-voting address', async() => {
    //    const voting = await votingContract(votingId);
    //    const jetton = await userWallet(user1.address);

    //    let res = await testDAO.sendConfirmVoting(user1.getSender(), votingId, jetton.address)
    //    expect(res.transactions).toHaveTransaction({
    //        from: user1.address,
    //        on: DAO.address,
    //        success: false,
    //        exitCode: Errors.minter.unauthorized_vote_execution 
    //    });
    //    expect(res.transactions).not.toHaveTransaction({
    //        from: DAO.address,
    //        on: jetton.address
    //    });

    //    res = await testDAO.sendConfirmVoting(blockchain.sender(voting.address), votingId, jetton.address)

    //    expect(res.transactions).toHaveTransaction({
    //        from:voting.address,
    //        on: DAO.address,
    //        success: true
    //    });
    //});

    //it('Vote confirmation should voting address should depend on voting id', async() => {

    //    const voting = await votingContract(votingId);
    //    const jetton = await userWallet(user1.address);

    //    let res = await testDAO.sendConfirmVoting(blockchain.sender(voting.address), votingId + 1n, user1.address)
    //    expect(res.transactions).toHaveTransaction({
    //        from: voting.address,
    //        on: DAO.address,
    //        success: false,
    //        exitCode: Errors.minter.unauthorized_vote_execution
    //    });
    //    expect(res.transactions).not.toHaveTransaction({
    //        from: DAO.address,
    //        on: user1.address
    //    });


    //});

    //it('jetton owner can vote with confirmation', async () => {
    //        expirationDate = renewExp(expirationDate);
    //        await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            beginCell().endCell() // payload
    //        );
    //        let voting = await votingContract(++votingId);
    //        const voteCtx  = (await voting.getData()) as voteCtx;
    //        votes[Number(votingId)] = voteCtx;

    //        let votingCode = await DAO.getVotingCode();
    //        const user1JettonWallet = await userWallet(user1.address);
    //        const walletBalance     = await user1JettonWallet.getTotalBalance();

    //        //let voteResult = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, false, true);
    //        let voteResult = await assertVoteChain(user1, user1JettonWallet,
    //                                               0n,
    //                                               walletBalance,
    //                                               voting.address,
    //                                               expirationDate,
    //                                               false, // Vote against
    //                                               true); // Require confirmation
    //        expect(voteResult.transactions).toHaveTransaction({ //vote_confirmation
    //                    from: user1JettonWallet.address,
    //                    on: user1.address,
    //                    body: beginCell().storeUint(Op.vote_confirmation, 32).storeUint(0, 64).endCell()
    //                });

    //        voteCtx.votedAgainst += walletBalance;


    //        assertKeeper(voting.address, user1JettonWallet, voteCtx.votedAgainst);

    //        let votingData = await voting.getData();

    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);

    //        expect(await user1JettonWallet.getJettonBalance()).toEqual(0n);
    //    });

    //    it('jetton balance unblocked after expiration date', async () => {
    //        const user1JettonWallet = await userWallet(user1.address);
    //        let   daoData           = await user1JettonWallet.getDaoData();

    //        expect(daoData.locked).toBeGreaterThan(0n);

    //        const totalBalance      = daoData.balance + daoData.locked;

    //        blockchain.now = Number(expirationDate + 1n);

    //        // await new Promise(res => setTimeout(res, Number((expirationDate + 1n) * 1000n) - Date.now()));
    //        // expect(await user1JettonWallet.getJettonBalance()).toEqual(totalBalance);

    //        daoData = await user1JettonWallet.getDaoData();
    //        expect(daoData.locked).toEqual(0n);
    //        expect(daoData.lockExpiration).toBe(0);

    //        // const wdata = await blockchain.runGetMethod(user1JettonWallet.address, 'get_wallet_data', [], /*{now: Number(expirationDate) + 1 }*/);
    //        // expect(wdata.stackReader.readBigNumber()).toEqual(totalBalance);
    //        // check that voting data didn't changed
    //        let voting     = await votingContract(0n);
    //        let votingData = await voting.getData();
    //        const voteCtx  = votes[0];
    //        expect(votingData.init).toEqual(voteCtx.init);
    //        expect(votingData.votedFor).toEqual(voteCtx.votedFor);
    //        expect(votingData.votedAgainst).toEqual(voteCtx.votedAgainst);
    //    });

    //    it('jetton owner can\'t vote after expiration date', async() => {
    //        expirationDate = getRandomExp(blockchain.now);

    //        await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            beginCell().endCell() // payload
    //        );

    //        const voting = await votingContract(++votingId);

    //        const user1JettonWallet = await userWallet(user1.address);
    //        let   userBalance = await user1JettonWallet.getTotalBalance();
    //        const voteFor     = true;
    //        const voteConfirm = false;

    //        let   res = await user1JettonWallet.sendVote(user1.getSender(),
    //                                                     voting.address,
    //                                                     expirationDate,
    //                                                     voteFor, voteConfirm);


    //        const sendVoteBody = VotingTests.submitVotesMessage(user1.address,
    //                                                            expirationDate,
    //                                                            userBalance,
    //                                                            voteFor, voteConfirm);
    //        let keepR = await voteKeeperContract(user1JettonWallet, voting.address);

    //        expect(res.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            on: voting.address,
    //            body: sendVoteBody ,
    //            success: true
    //        });

    //        blockchain.now = Number(expirationDate) + 1;

    //        const user2JettonWallet = await userWallet(user2.address);

    //        userBalance = await user2JettonWallet.getTotalBalance();

    //        res = await user2JettonWallet.sendVote(user2.getSender(),
    //                                               voting.address,
    //                                               expirationDate,
    //                                               voteFor, voteConfirm);

    //        keepR = await voteKeeperContract(user2JettonWallet, voting.address);

    //        expect(res.transactions).toHaveTransaction({
    //            from: user2.address,
    //            on: user2JettonWallet.address,
    //            body: JettonWallet.voteMessage(voting.address,
    //                                           expirationDate,
    //                                           voteFor, voteConfirm),
    //            success: false,
    //            exitCode: Errors.voting.voting_already_finished// already finished
    //        });
    //    });

    //    it('Regular vote won', async () => {

    //        let winner:ActiveWallet;
    //        let loser:ActiveWallet;

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            winMsg // payload
    //        );

    //        expect(votingRes.transactions).toHaveTransaction({ //notification
    //                    from: DAO.address,
    //                    on: user1.address,
    //                    body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
    //                                     .storeUint(0, 64) //query_id
    //                                     .storeAddress(voting.address) //voting_code
    //                                     .endCell()
    //        });

    //        const comp = await pickWinner(user1, user2);

    //        await comp.winner.jetton.sendVote(comp.winner.user.getSender(),
    //                                          voting.address,
    //                                          expirationDate, true, false);

    //        await comp.loser.jetton.sendVote(comp.loser.user.getSender(),
    //                                         voting.address,
    //                                         expirationDate, false, false);

    //        blockchain.now = Number(expirationDate) + 1;
    //        // await new Promise(res => setTimeout(res, Number(td * 1000n)));

    //        let voteData = await voting.getData();
    //        expect(voteData.executed).toBe(false);

    //        const res = await voting.sendEndVoting(user1.getSender());

    //        expect(res.transactions).toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address,
    //            body: JettonMinterTests.createExecuteVotingMessage(votingId,
    //                                                               expirationDate,
    //                                                               defaultVotingType,
    //                                                               voteData.votedFor,
    //                                                               voteData.votedAgainst,
    //                                                               winMsg)
    //        });

    //        voteData = await voting.getData();
    //        expect(voteData.executed).toBe(true);

    //        // Expect winMsg to be sent from DAO
    //        expect(res.transactions).toHaveTransaction({
    //            from: DAO.address,
    //            on: user1.address,
    //            body: payload
    //        });

    //        votes[Number(votingId)] = voteData;
    //    })

    //    it('Vote lost', async () => {

    //        let winner:ActiveWallet;
    //        let loser:ActiveWallet;

    //        expirationDate   = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        expect(votingRes.transactions).toHaveTransaction({ //notification
    //                    from: DAO.address,
    //                    on: user1.address,
    //                    body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
    //                                     .storeUint(0, 64) //query_id
    //                                     .storeAddress(voting.address) //voting_code
    //                                     .endCell()
    //        });

    //        const comp = await pickWinner(user1, user2);

    //        // Now winner votes against
    //        await comp.winner.jetton.sendVote(comp.winner.user.getSender(),
    //                                          voting.address,
    //                                          expirationDate, false, false);

    //        await comp.loser.jetton.sendVote(comp.loser.user.getSender(),
    //                                         voting.address,
    //                                         expirationDate, true, false);

    //        blockchain.now = Number(expirationDate) + 1;
    //        // await new Promise(res => setTimeout(res, Number(td * 1000n)));

    //        let voteData = await voting.getData();
    //        expect(voteData.executed).toBe(false);

    //        const res = await voting.sendEndVoting(user1.getSender());

    //        expect(res.transactions).toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address,
    //            success: true,
    //            body: JettonMinterTests.createExecuteVotingMessage(votingId,
    //                                                               expirationDate,
    //                                                               defaultVotingType,
    //                                                               voteData.votedFor,
    //                                                               voteData.votedAgainst,
    //                                                               winMsg
    //                                                              )
    //        });

    //        voteData = await voting.getData();

    //        expect(voteData.executed).toBe(true);

    //        // No proposal message from DAO
    //        expect(res.transactions).not.toHaveTransaction({
    //            from: DAO.address,
    //            on: user1.address,
    //            body: payload,
    //        });

    //        votes[Number(votingId)] = voteData;
    //    })

    //    it('End voting should only be allowed after expiery', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            toNano('0.1'), // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);

    //        let res = await voting.sendEndVoting(user1.getSender());

    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.voting_not_finished // not finished
    //        });
    //        expect(res.transactions).not.toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address
    //        });

    //    });

    //    it('End voting message value should be >= minimal execution amount', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            execAmount, // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);

    //        blockchain.now = Number(expirationDate) + 1;
    //        let res = await voting.sendEndVoting(user1.getSender(), execAmount - 1n);

    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.not_enough_money// no money
    //        });
    //        expect(res.transactions).not.toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address
    //        });

    //    });

    //    it('Voting can only be executed once', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            execAmount, // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);

    //        blockchain.now = Number(expirationDate) + 1;
    //        let res = await voting.sendEndVoting(user1.getSender(), execAmount);
    //        const votingData = await voting.getData();

    //        expect(votingData.executed).toBe(true);

    //        res = await voting.sendEndVoting(user1.getSender(), execAmount);
    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.voting_already_executed// already executed
    //        });
    //        expect(res.transactions).not.toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address
    //        });
    //    });

    //    it('Voting should only accept votes from keeper', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);
    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await testVotingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            execAmount, // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        const keepR      = await voteKeeperContract(user1JettonWallet, voting.address);
    //        const dataBefore = await voting.getData();
    //        const voteNum    = BigInt(getRandomInt(1000, 2000));
    //        let   res        = await voting.sendSubmitVote(user1.getSender(),
    //                                                      user1.address,
    //                                                      expirationDate,
    //                                                      voteNum,
    //                                                      true,
    //                                                      false);
    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.unauthorized_vote,
    //        });
    //        let dataAfter = await voting.getData();

    //        expect(dataBefore.votedFor).toEqual(dataAfter.votedFor);

    //        res = await voting.sendSubmitVote(blockchain.sender(keepR.address),
    //                                          user1.address,
    //                                          expirationDate,
    //                                          voteNum,
    //                                          true,
    //                                          false);

    //        expect(res.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            on: voting.address,
    //            success: true
    //        });

    //        dataAfter = await voting.getData();
    //        expect(dataAfter.votedFor).toEqual(dataBefore.votedFor + voteNum);
    //    });

    //    it('Voting should only submit votes before expiration date', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);
    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await testVotingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            execAmount, // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        const keepR   = await voteKeeperContract(user1JettonWallet, voting.address);
    //        const voteNum = BigInt(getRandomInt(1000, 2000));
    //        // Let's pretend half of the time has passed
    //        if(blockchain.now !== undefined) {
    //            const timeDiff = Number(expirationDate) - blockchain.now;
    //            blockchain.now += Math.floor(timeDiff / 2);
    //        }

    //        let res = await voting.sendSubmitVote(blockchain.sender(keepR.address),
    //                                              user1.address,
    //                                              expirationDate,
    //                                              voteNum,
    //                                              true,
    //                                              false);
    
    //        expect(res.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            on: voting.address,
    //            success: true
    //        });

    //        const dataBefore = await voting.getData();
    //        // Now voting is finished
    //        blockchain.now   = Number(expirationDate) + 1;
    //        res = await voting.sendSubmitVote(blockchain.sender(keepR.address),
    //                                          user1.address,
    //                                          expirationDate,
    //                                          voteNum,
    //                                          true,
    //                                          false);

    //        expect(res.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.voting_already_finished
    //        });

    //        const dataAfter = await voting.getData();
    //        expect(dataAfter.votedFor).toEqual(dataBefore.votedFor);
    //    });

    //    it('Voting should not trust user-supplied expiration date', async() =>{
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);
    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await testVotingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        const votingRes = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //            expirationDate,
    //            execAmount, // minimal_execution_amount
    //            winMsg// payload
    //        );

    //        await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        const keepR   = await voteKeeperContract(user1JettonWallet, voting.address);
    //        const voteNum = BigInt(getRandomInt(1000, 2000));

    //        const dataBefore = await voting.getData();

    //        const fakeExpDate = expirationDate - 1n;
    //        // User is going to supply expirationDate higher than stored one
    //        let res = await voting.sendSubmitVote(blockchain.sender(keepR.address),
    //                                              user1.address,
    //                                              fakeExpDate,
    //                                              voteNum,
    //                                              true,
    //                                              false);
    //        expect(res.transactions).toHaveTransaction({
    //            from: keepR.address,
    //            on: voting.address,
    //            success: false,
    //            exitCode: Errors.voting.wrong_expiration_date
    //        });
    //        const dataAfter = await voting.getData();
    //        expect(dataAfter.votedFor).toEqual(dataBefore.votedFor);
    //    });
    //    it('Keeper should only accept messages from corresponding jetton wallet', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);
    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        let   res        = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //                                                      expirationDate,
    //                                                      execAmount, // minimal_execution_amount
    //                                                      winMsg// payload
    //        );

    //        const balance  = await user1JettonWallet.getTotalBalance();
    //        res            = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        const keepR    = await testKeeperContract(user1JettonWallet, voting.address);
    //        const voteBody = VoteKeeperTests.requestVoteMessage(user1.address,
    //                                                            expirationDate,
    //                                                            balance,
    //                                                            true, false);

    //        // Verify that same message from jetton wallet works fine
    //        expect(res.transactions).toHaveTransaction({
    //            from: user1JettonWallet.address,
    //            on: keepR.address,
    //            body: voteBody,
    //            success: true
    //        });
    //        assertKeeper(voting.address, user1JettonWallet, balance);
    //        // Testing message from other jetton wallet
    //        const otherJetton = await userWallet(user2.address);
    //        res  = await keepR.sendRequestVote(blockchain.sender(otherJetton.address),
    //                                                             user1.address,
    //                                                             expirationDate,
    //                                                             balance,
    //                                                             true, false);
    //        expect(res.transactions).toHaveTransaction({
    //            from: otherJetton.address,
    //            on: keepR.address,
    //            body: voteBody,
    //            success: false,
    //            exitCode: Errors.keeper.unauthorized_request_vote,
    //        });
    //        // Make sure nothing changed in terms of stored votes
    //        assertKeeper(voting.address, user1JettonWallet, balance);

    //        //Try same thing with regular wallet (just in case)
    //        res  = await keepR.sendRequestVote(blockchain.sender(user1.address),
    //                                                             user1.address,
    //                                                             expirationDate,
    //                                                             balance,
    //                                                             true, false);
    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: keepR.address,
    //            body: voteBody,
    //            success: false,
    //            exitCode: Errors.keeper.unauthorized_request_vote,
    //        });
    //        assertKeeper(voting.address, user1JettonWallet, balance);

    //    });
    //    it('Keeper should accept only new votes', async() => {
    //        const user1JettonWallet = await userWallet(user1.address);

    //        expirationDate = getRandomExp(blockchain.now);
    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        let voting = await votingContract(++votingId);

    //        const execAmount = getRandomTon(1, 10);
    //        let   res        = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
    //                                                      expirationDate,
    //                                                      execAmount, // minimal_execution_amount
    //                                                      winMsg// payload
    //        );

    //        const balance  = await user1JettonWallet.getTotalBalance();
    //        res            = await user1JettonWallet.sendVote(user1.getSender(), voting.address, expirationDate, true, false);
    //        assertKeeper(voting.address, user1JettonWallet, balance);
    //        const keepR    = await testKeeperContract(user1JettonWallet, voting.address);
    //        const voteBody = VoteKeeperTests.requestVoteMessage(user1.address,
    //                                                            expirationDate,
    //                                                            balance,
    //                                                            true, false);
    //        // Let's pretend that same wallet send < balance vote, so there is noting to account for
    //        res = await keepR.sendRequestVote(blockchain.sender(user1JettonWallet.address),
    //                                          user1.address,
    //                                          expirationDate,
    //                                          balance - 1n,
    //                                          true, false);
    //        expect(res.transactions).toHaveTransaction({
    //            from: user1JettonWallet.address,
    //            on: keepR.address,
    //            exitCode: Errors.keeper.no_new_votes 
    //        });
    //        assertKeeper(voting.address, user1JettonWallet, balance);

    //    });


    //    it('Execute vote result should only allow voting address', async() => {

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);

    //        const supply   = await DAO.getTotalSupply();

    //        const voting       = await votingContract(votingId);
    //        const votingSender = blockchain.sender(voting.address);

    //        blockchain.now = Number(expirationDate) + 1;

    //        let res = await testDAO.sendExecuteVotingMessage(user1.getSender(),
    //                                                         votingId,
    //                                                         expirationDate,
    //                                                         defaultVotingType,
    //                                                         supply,
    //                                                         0n,
    //                                                         winMsg);

    //        const proposalTrans = {
    //            from: DAO.address,
    //            to: user1.address,
    //            body: payload
    //        };

    //        expect(res.transactions).toHaveTransaction({
    //            from: user1.address,
    //            on: DAO.address,
    //            success: false,
    //            exitCode: Errors.minter.unauthorized_vote_execution
    //        });

    //        expect(res.transactions).not.toHaveTransaction(proposalTrans);

    //        res = await testDAO.sendExecuteVotingMessage(votingSender,
    //                                                     votingId,
    //                                                     expirationDate,
    //                                                     defaultVotingType,
    //                                                     supply,
    //                                                     0n,
    //                                                     winMsg);
    //        expect(res.transactions).toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address,
    //            success: true
    //        });

    //        expect(res.transactions).toHaveTransaction(proposalTrans);
    //    });

    //    it('Vote should not execute before expiery', async () => {

    //        expirationDate = getRandomExp(blockchain.now);

    //        const payload  = getRandomPayload();
    //        const winMsg   = genMessage(user1.address, payload);
    //        const supply   = await DAO.getTotalSupply();
    //        const voting   = await votingContract(votingId);
    //        const votingSender = blockchain.sender(voting.address);

    //        let res = await testDAO.sendExecuteVotingMessage(votingSender,
    //                                                         votingId,
    //                                                         expirationDate,
    //                                                         defaultVotingType,
    //                                                         supply,
    //                                                         0n,
    //                                                         winMsg);

    //        const proposalTrans = {
    //            from: DAO.address,
    //            to: user1.address,
    //            body: payload
    //        };

    //        expect(res.transactions).toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address,
    //            success: false,
    //            exitCode: Errors.voting.voting_not_finished
    //        });

    //        expect(res.transactions).not.toHaveTransaction(proposalTrans);

    //        blockchain.now = Number(expirationDate) + 1;

    //        res = await testDAO.sendExecuteVotingMessage(votingSender,
    //                                                     votingId,
    //                                                     expirationDate,
    //                                                     defaultVotingType,
    //                                                     supply,
    //                                                     0n,
    //                                                     winMsg);
    //        expect(res.transactions).toHaveTransaction({
    //            from: voting.address,
    //            on: DAO.address,
    //            success: true
    //        });

    //        expect(res.transactions).toHaveTransaction(proposalTrans);
    //    });

        it('DAO self-admin case', async () => {
            const prevAdmin = await DAO.getAdminAddress();
            let res = await DAO.sendChangeAdmin(user1.getSender(), DAO.address);
            expect(res.transactions).toHaveTransaction({
                from: user1.address,
                to: DAO.address,
                success: true,
            });

            expirationDate = getRandomExp(blockchain.now);

            let curAdmin = await DAO.getAdminAddress();
            // DAO now admins itself
            expect(DAO.address.equals(curAdmin)).toBeTruthy();

            // Now we need to craft admin change message
            const adminChg  = JettonMinter.changeAdminMessage(user2.address);
            const chgMsg    = genMessage(DAO.address, adminChg);

            // Create voting
            let createVoting = await DAO.sendCreateSimpleMsgVoting(user1.getSender(),
                                       expirationDate,
                                       toNano('0.1'), // minimal_execution_amount
                                       chgMsg // payload
            );
            // Voting deploy message
            const voting = await votingContract(++votingId);
            expect(createVoting.transactions).toHaveTransaction({
                from: DAO.address,
                on: voting.address,
                deploy: true
            });

            const user2JettonWallet = await userWallet(user2.address);

            await user2JettonWallet.sendVote(user2.getSender(),
                                             voting.address,
                                             expirationDate,
                                             true, false);

            blockchain.now = Number(expirationDate) + 1;
            // await blockchain.setVerbosityForAddress(DAO.address, {blockchainLogs:true, vmLogs: 'vm_logs'});
            // payload doesn't pass the filter. exit code 9, on load created_lt.
            res = await voting.sendEndVoting(user2.getSender());

            expect(res.transactions).toHaveTransaction({
                from: DAO.address,
                on: DAO.address,
                success: true,
                body: adminChg
            });

            curAdmin = await DAO.getAdminAddress();
            expect(curAdmin.equals(user2.address)).toBe(true);

            // We have to set admin all the way back to make sure other cases work fine
            await DAO.sendChangeAdmin(user2.getSender(), prevAdmin);
        });

        it('Code upgrade should only be allowed from admin', async() => {
            const curAdmin    = await DAO.getAdminAddress();
            const notAdmin    = differentAddress(curAdmin);

            let res = await DAO.sendCodeUpgrade(blockchain.sender(notAdmin), minter_update, null);
            expect(res.transactions).toHaveTransaction({
                from: notAdmin,
                on: DAO.address,
                success: false,
                exitCode: Errors.minter.unauthorized_code_upgrade_request
            });

        });

        it('Code upgrade successfull', async () => {
            // Will slack compiling modified voting and use random cell
            const votingUpdate = getRandomPayload();
            const prevVoting   = await DAO.getVotingCode();
            expect(prevVoting.equals(votingUpdate)).toBe(false);

            const testMsg = internal({
                from: user1.address,
                to: DAO.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(42, 32).storeUint(0, 64).endCell()
            });

            // Expect unknown op
            let res = await blockchain.sendMessage(testMsg);
            expect(res.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: false,
                exitCode: Errors.unknown_op

            });

            res = await DAO.sendCodeUpgrade(user1.getSender(), minter_update, votingUpdate);

            expect(res.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });


            // Now it supposed to work
            res = await blockchain.sendMessage(testMsg);
            expect(res.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });

            // Voting code should update too
            expect((await DAO.getVotingCode()).equals(votingUpdate)).toBe(true);

            // Have to switch code back since we drag blockchain state
            await DAO.sendCodeUpgrade(user1.getSender(), minter_code, prevVoting);
            expect(res.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });
        });
        describe('Poll type voting (with send result)', () => {
            const voteType = 1n;
            let duration : number;
            let votingResults: SandboxContract<VotingResults>;
            let pollBody: Cell;
            let proposal: Cell;

            it('should create a new type 1 voting', async () => {
                duration = getRandomInt(10, 1200);
                expirationDate = BigInt(blockchain.now! + duration);
                let voting = await votingContract(++votingId);
                pollBody = beginCell().storeStringTail("Is DAO related to Daoism?").storeUint(123, 8).endCell();
                proposal = Voting.createPollProposal(duration, pollBody);

                votingResults = await resultsContract(duration, pollBody);

                let createVoting = await DAO.sendCreatePollVoting(user1.getSender(), duration, pollBody);
                // Voting deploy message
                expect(createVoting.transactions).toHaveTransaction({
                    from: DAO.address,
                    on: voting.address,
                    success: true,
                    deploy: true
                });

                // Voting initiated message to DAO
                expect(createVoting.transactions).toHaveTransaction({
                    from: voting.address,
                    on: DAO.address,
                    success: true,
                    body: JettonMinterTests.createVotingInitiated(votingId, expirationDate, user1.address)
                });

                // Confirmation message
                expect(createVoting.transactions).toHaveTransaction({ //notification
                            from: DAO.address,
                            on: user1.address,
                            body: beginCell().storeUint(Op.minter.voting_created, 32) //// voting created
                                             .storeUint(0, 64) //query_id
                                             .storeAddress(voting.address) //voting_code
                                             .endCell()
                        });

                const votingData = await voting.getFullData();

                expect(votingData.votingId).toEqual(votingId);
                expect(votingData.daoAddress).toEqualAddress(DAO.address);
                expect(votingData.proposal).toEqualCell(proposal);
                expect(votingData.executed).toBe(false);
                expect(votingData.expirationDate).toEqual(expirationDate);
                expect(votingData.initiator).toEqualAddress(user1.address);
                expect(votingData.init).toEqual(true);
                expect(votingData.votedFor).toEqual(0n);
                expect(votingData.votedAgainst).toEqual(0n);
                expect(votingData.votingType).toEqual(voteType);

                const resultsContractData = await votingResults.getData();
                expect(resultsContractData.init).toEqual(true);
                expect(resultsContractData.votingId).toEqual(votingId);
                expect(resultsContractData.votesFor).toEqual(0n);
                expect(resultsContractData.votesAgainst).toEqual(0n);
                expect(resultsContractData.votingBody).toEqualCell(pollBody);
                expect(resultsContractData.votingDuration).toEqual(duration);
                expect(resultsContractData.daoAddress.equals(DAO.address)).toBe(true);
                expect(resultsContractData.finished).toEqual(false);
        });
        it('should vote and end with sending', async () => {
            let voting = await votingContract(votingId);
            const expirationDate = (await voting.getFullData()).expirationDate;
            const comp = await pickWinner(user1, user2);

            await comp.winner.jetton.sendVote(comp.winner.user.getSender(),
                                              voting.address,
                                              expirationDate, true, false);

            await comp.loser.jetton.sendVote(comp.loser.user.getSender(),
                                             voting.address,
                                             expirationDate, false, false);

            blockchain.now = Number(expirationDate) + 1;

            const voteData = await voting.getFullData();
            const res = await voting.sendEndVoting(user1.getSender());

            expect(res.transactions).toHaveTransaction({
                from: voting.address,
                on: DAO.address,
                body: JettonMinterTests.createExecuteVotingMessage(votingId,
                                                                   expirationDate,
                                                                   voteType, // custom voting type
                                                                   voteData.votedFor,
                                                                   voteData.votedAgainst,
                                                                   proposal)
            });

            expect(res.transactions).toHaveTransaction({
                from: DAO.address,
                on: votingResults.address,
                success: true,
                body: VotingResults.createVoteResult(votingId,
                                                     voteData.votedFor,
                                                     voteData.votedAgainst)
            });

            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.votesFor).toEqual(voteData.votedFor);
            expect(resultsData.votesAgainst).toEqual(voteData.votedAgainst);
            expect(resultsData.votingBody).toEqualCell(pollBody);
            expect(resultsData.votingDuration).toEqual(duration);
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.finished).toEqual(true);
        });
        it('should not create with zero duration', async () => {
            const voting = await votingContract(++votingId);
            duration = 0;
            let createRes = await DAO.sendCreatePollVoting(user1.getSender(), duration);
            expect(createRes.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: false,
                exitCode: Errors.voting.voting_already_finished
            });
            duration = 1; // now ok
            createRes = await DAO.sendCreatePollVoting(user1.getSender(), duration);
            expect(createRes.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                on: voting.address,
                success: true,
                deploy: true
            });
        });
        it('should not create with too big duration', async () => {
            const voting = await votingContract(++votingId);
            // now it's 30d
            duration = 30 * 24 * 60 * 60;
            let createRes = await DAO.sendCreatePollVoting(user1.getSender(), duration);
            expect(createRes.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: false,
                exitCode: Errors.voting.expiration_date_too_high
            });
            duration -= 1;
            createRes = await DAO.sendCreatePollVoting(user1.getSender(), duration);
            expect(createRes.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                on: voting.address,
                success: true,
                deploy: true
            });
        });
        it('balance should not decrease after creating a voting', async () => {
            const voting = await votingContract(++votingId);
            expirationDate = BigInt(blockchain.now! + duration);
            const balanceBefore = (await blockchain.getContract(DAO.address)).balance;
            const createRes = await DAO.sendCreatePollVoting(user1.getSender(), duration);
            expect(createRes.transactions).toHaveTransaction({
                from: user1.address,
                on: DAO.address,
                success: true
            });
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                on: voting.address,
                success: true,
                deploy: true
            });
            expect(createRes.transactions).toHaveTransaction({
                from: voting.address,
                on: DAO.address,
                success: true,
                body: JettonMinterTests.createVotingInitiated(votingId, expirationDate, user1.address)
            });
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: user1.address,
                body: JettonMinterTests.createVotingCreated(voting.address)
            });

            const balanceAfter = (await blockchain.getContract(DAO.address)).balance;
            expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
            console.log("Create voting balance increase:", fromNano((balanceAfter - balanceBefore)));
        });
        let initBody: Cell;
        let sendVoteResBody: Cell;
        let votedFor: bigint;
        let votedAgainst: bigint;
        it('VotingResults should not be inited not from the DAO', async () => {
            duration = getRandomDuration();
            expirationDate = BigInt(blockchain.now! + duration);
            pollBody = getRandomPayload();
            votingResults = await resultsContract(duration, pollBody);
            initBody = beginCell().storeUint(Op.results.init_voting_results, 32)
                                  .storeUint(0, 64).storeUint(votingId, 64)
                        .endCell();


            const from = differentAddress(DAO.address)
            const createRes = await blockchain.sendMessage(internal({
                from, to: votingResults.address,
                value: toNano("0.1"),
                body: initBody,
                stateInit: votingResults.init
            }));
            expect(createRes.transactions).toHaveTransaction({
                from, to: votingResults.address,
                success: false,
                exitCode: Errors.voting.unauthorized_init
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(-1n); // doesn't know his voting id yet
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.init).toEqual(false);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should not receive the results before init', async () => {
            votedFor = getRandomTon(1, 1000);
            votedAgainst = getRandomTon(1, 1000);
            sendVoteResBody = VotingResults.createVoteResult(votingId, votedFor, votedAgainst);
            const sendVoteResRes = await blockchain.sendMessage(internal({
                from: DAO.address,
                to: votingResults.address,
                value: toNano("0.1"),
                body: sendVoteResBody
            }));
            expect(sendVoteResRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: votingResults.address,
                success: false,
                exitCode: Errors.voting.not_inited
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(-1n);
            expect(resultsData.init).toEqual(false);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should be inited from the DAO', async () => {
            const createRes = await blockchain.sendMessage(internal({
                from: DAO.address,
                to: votingResults.address,
                value: toNano("0.1"),
                body: initBody
            }));
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: votingResults.address,
                success: true,
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should not be inited twice', async () => {
            const createRes = await blockchain.sendMessage(internal({
                from: DAO.address,
                to: votingResults.address,
                value: toNano("0.1"),
                body: initBody
            }));
            expect(createRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: votingResults.address,
                success: false,
                exitCode: Errors.voting.already_inited
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should not receive the results not from the DAO', async () => {
            const from = differentAddress(DAO.address)
            const sendVoteResRes = await blockchain.sendMessage(internal({
                from, to: votingResults.address,
                value: toNano("0.1"),
                body: sendVoteResBody
            }));
            expect(sendVoteResRes.transactions).toHaveTransaction({
                from, to: votingResults.address,
                success: false,
                exitCode: Errors.results.unauthorized_vote_results,
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should not receive the results for not it\'s voting', async () => {
            const sendVoteResIdLower = VotingResults.createVoteResult(votingId + 1n, votedFor, votedAgainst);
            const sendVoteResIdHigher = VotingResults.createVoteResult(votingId + 1n, votedFor, votedAgainst);
            for (const sendVoteResBody of [sendVoteResIdLower, sendVoteResIdHigher]) {
                let sendVoteResRes = await blockchain.sendMessage(internal({
                    from: DAO.address,
                    to: votingResults.address,
                    value: toNano("0.1"),
                    body: sendVoteResBody
                }));
                expect(sendVoteResRes.transactions).toHaveTransaction({
                    from: DAO.address,
                    to: votingResults.address,
                    success: false,
                    exitCode: Errors.results.voting_id_mismatch,
                });
            }
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(false);
            expect(resultsData.votesFor).toEqual(0n);
            expect(resultsData.votesAgainst).toEqual(0n);
        });
        it('VotingResults should receive the results', async () => {
            const sendVoteResRes = await blockchain.sendMessage(internal({
                from: DAO.address,
                to: votingResults.address,
                value: toNano("0.1"),
                body: sendVoteResBody
            }));
            expect(sendVoteResRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: votingResults.address,
                success: true,
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(true);
            expect(resultsData.votesFor).toEqual(votedFor);
            expect(resultsData.votesAgainst).toEqual(votedAgainst);
        });
        it('should not receive the results once again', async () => {
            const sendVoteResRes = await blockchain.sendMessage(internal({
                from: DAO.address,
                to: votingResults.address,
                value: toNano("0.1"),
                body: sendVoteResBody
            }));
            expect(sendVoteResRes.transactions).toHaveTransaction({
                from: DAO.address,
                to: votingResults.address,
                success: false,
                exitCode: Errors.results.already_finished
            });
            const resultsData = await votingResults.getData();
            expect(resultsData.votingId).toEqual(votingId);
            expect(resultsData.daoAddress.equals(DAO.address)).toBe(true);
            expect(resultsData.init).toEqual(true);
            expect(resultsData.finished).toEqual(true);
            expect(resultsData.votesFor).toEqual(votedFor);
            expect(resultsData.votesAgainst).toEqual(votedAgainst);
        });
        it('should not create type 1 voting if only polls', async () => {
            // edit file ../../contracts/external_params.func, set line 8 to
            //  const int external_param::only_polls = 1;
            // recompile
            // and edit back to
            //  const int external_param::only_polls = 0;
            let _minter_code: Cell;
            const path = "/../../contracts/external_params.func";
            let text = readFileSync(__dirname + path, 'utf8');
            var edited = text.replace(/only_polls = 0/g, 'only_polls = -1');
            writeFileSync(__dirname + path, edited, 'utf8');
            _minter_code = await compile("JettonMinter");
            // back to normal
            writeFileSync(__dirname + path, text, 'utf8');
            let _DAO = blockchain.openContract(
                 JettonMinter.createFromConfig(
                   {
                     admin: user1.address,
                     content: defaultContent,
                     voting_code: voting_code,
                   }, _minter_code));

            await _DAO.sendDeploy(user1.getSender(), toNano('1'));

            expect(_DAO.address.equals(DAO.address)).toBe(false);
            expect(user1.address.equals(await _DAO.getAdminAddress())).toBe(true);

            const payload  = getRandomPayload();
            const winMsg   = genMessage(user1.address, payload);
            const createVotingRes = await _DAO.sendCreateSimpleMsgVoting(user1.getSender(),
                expirationDate,
                toNano('0.1'), // minimal_execution_amount
                winMsg // payload
            );
            expect(createVotingRes.transactions).toHaveTransaction({
                from: user1.address,
                to: _DAO.address,
                success: false,
                exitCode: Errors.minter.forbidden_vote_id
            });
        });
    });
});
