export abstract class Errors {
	static readonly unknown_op = 0xffff;
	static readonly wrong_workchain = 333;
	
	
	// jetton wallet errors
	static readonly wallet = {
		unauthorized_transfer : 705,
		not_enough_jettons : 706,
		unauthorized_incoming_transfer : 707,
		malformed_forward_payload : 708,
		not_enough_tons : 709,
		burn_fee_not_matched : 707,
		unknown_action : 0xFFFF,
		unknown_action_bounced : 0xFFF0,
		unauthorized_vote_submition : 710 //todo
	}
	
	// jetton minter errors
	static readonly minter = {
		discovery_fee_not_matched : 75,
		unauthorized_mint_request : 73,
		unauthorized_burn_request : 74,
		unauthorized_change_admin_request : 76,
		unauthorized_change_content_request : 77,
		unauthorized_vote_execution : 78,
		unauthorized_code_upgrade_request : 79,
		voting_discovery_fee_not_matched : 80,
        forbidden_vote_id : 81
	}
	
	// voting errors
	static readonly voting = {
		already_inited : 0xf3,
		not_inited : 0xf31,
		wrong_expiration_date : 0xf32,
		unauthorized_init : 0xf4,
		unauthorized_vote : 0xf5,
		voting_not_finished : 0xf6,
		not_enough_money : 0xf7,
		voting_already_executed : 0xf8,
		voting_already_finished : 0xf9,
		expiration_date_too_high : 0xf10
	}

	// vote controller errors
	static readonly keeper = {
		no_new_votes : 0x1f5,
		unauthorized_request_vote : 0x1f4
	}

    // voting results errors
    static readonly results = {
        already_finished : 0x2f5,
        unauthorized_vote_results : 0x2f6,
        voting_id_mismatch : 0x2f7
    }
}
