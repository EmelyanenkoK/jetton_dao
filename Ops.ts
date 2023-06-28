export abstract class Op {
	static readonly transfer = 0xf8a7ea5;
	static readonly transfer_notification = 0x7362d09c;
	static readonly internal_transfer = 0x178d4519;
	static readonly excesses = 0xd53276db;
	static readonly burn = 0x595f07bc;
	static readonly burn_notification = 0x7bdd97de;
	static readonly withdraw_tons = 0x6d8e5e3c;
	static readonly withdraw_jettons = 0x768a50b2;
	
	static readonly vote = 0x69fb306c;
	static readonly create_voting_through_wallet = 0x318eff17;
	static readonly confirm_voting = 0x039a374e;
	static readonly vote_confirmation = 0x5fe9b8ca;
	static readonly voting_confirmation = 0x2ccba006;
	
	// Voting
	static readonly voting = {
		init_voting : 0x182d8ddd,
		submit_votes : 0x6edb1889,
		end_voting : 0x66173a45
	}
	
	// Minter
	
	static readonly minter = {
		mint : 0x1674b0a0,
		change_admin : 0x4840664f,
		change_content : 0x5773d1f5,
		upgrade_code : 0x34aea60d,
		
		create_voting : 0x1c7f9a1a,
		voting_initiated : 0x8e2abb23,
		execute_vote_result : 0x4f0f7510,
		voting_created : 0xc39f0be6, // to user
		request_confirm_voting : 0x0222fdcb,
		
		
		provide_wallet_address : 0x2c76b973,
		take_wallet_address : 0xd1735400,
		send_vote_result: 0x57fe3672
	}
	
	// Keeper
	static readonly keeper = {
		request_vote : 0x2bd63704
	}
	
	// Admin
	static readonly admin = {
		jettons_burned : 0x319b0cdc
	}

    // Voting Results
    static readonly results = {
        execute_vote_result : 0x4f0f7510,
        send_vote_result : 0x57fe3672,
        init_voting_results : 0x66afdef2,
        provide_voting_results : 0x7546a34d,
        take_voting_results : 0xd1bb7471
    }
}
