use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn};

declare_id!("DYbxeGowTbDMQ1qg4wLYM7Ujr7zNc1UMeHGm6qoDbLsA");

#[program]
pub mod ranger_vault_strategy {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, vault_bump: u8) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.authority = ctx.accounts.authority.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_shares = 0;
        vault.total_tokens = 0;
        vault.bump = vault_bump;
        vault.is_active = true;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let vault = &ctx.accounts.vault_state;
        require!(vault.is_active, VaultError::VaultInactive);

        let shares_to_mint = if vault.total_shares == 0 || vault.total_tokens == 0 {
            amount
        } else {
            amount.checked_mul(vault.total_shares).unwrap().checked_div(vault.total_tokens).unwrap()
        };

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        let vault_key = ctx.accounts.vault_state.key();
        let seeds = &[b"vault", vault_key.as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer_seeds = &[&seeds[..]];

        let mint_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_share_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::mint_to(mint_ctx, shares_to_mint)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_add(amount).unwrap();
        vault.total_shares = vault.total_shares.checked_add(shares_to_mint).unwrap();
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        require!(shares_to_burn > 0, VaultError::ZeroAmount);
        let vault = &ctx.accounts.vault_state;
        require!(vault.is_active, VaultError::VaultInactive);
        require!(vault.total_shares > 0, VaultError::InsufficientShares);

        let tokens_to_return = shares_to_burn.checked_mul(vault.total_tokens).unwrap().checked_div(vault.total_shares).unwrap();
        require!(tokens_to_return <= vault.total_tokens, VaultError::InsufficientFunds);

        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.withdrawer_share_account.to_account_info(),
                authority: ctx.accounts.withdrawer.to_account_info(),
            },
        );
        token::burn(burn_ctx, shares_to_burn)?;

        let vault_key = ctx.accounts.vault_state.key();
        let seeds = &[b"vault", vault_key.as_ref(), &[ctx.accounts.vault_state.bump]];
        let signer_seeds = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.withdrawer_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_ctx, tokens_to_return)?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_tokens = vault.total_tokens.checked_sub(tokens_to_return).unwrap();
        vault.total_shares = vault.total_shares.checked_sub(shares_to_burn).unwrap();
        Ok(())
    }
}

#[account]
pub struct VaultState {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub share_mint: Pubkey,
    pub total_shares: u64,
    pub total_tokens: u64,
    pub bump: u8,
    pub is_active: bool,
}

#[derive(Accounts)]
#[instruction(vault_bump: u8)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 154, seeds = [b"vault_state", authority.key().as_ref(), token_mint.key().as_ref()], bump)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA
    #[account(seeds = [b"vault", vault_state.key().as_ref()], bump = vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(init, payer = authority, token::mint = token_mint, token::authority = vault_authority)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(init, payer = authority, mint::decimals = 6, mint::authority = vault_authority)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, has_one = vault_token_account, has_one = share_mint)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA
    #[account(seeds = [b"vault", vault_state.key().as_ref()], bump = vault_state.bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub depositor_share_account: Account<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, has_one = vault_token_account, has_one = share_mint)]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA
    #[account(seeds = [b"vault", vault_state.key().as_ref()], bump = vault_state.bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut)]
    pub withdrawer_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub withdrawer_share_account: Account<'info, TokenAccount>,
    pub withdrawer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")] ZeroAmount,
    #[msg("Insufficient shares")] InsufficientShares,
    #[msg("Insufficient funds")] InsufficientFunds,
    #[msg("Vault is currently inactive")] VaultInactive,
}
