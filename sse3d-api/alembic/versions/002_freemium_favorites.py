"""Freemium favorites: add User table, update FavoriteQuestion

Revision ID: 002
Revises: 001
Create Date: 2025-01-01 12:10:00

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # 1. Criar tabela User
    op.create_table(
        'user',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_user_email', 'user', ['email'], unique=True)

    # 2. Adicionar user_id (nullable) à FavoriteQuestion existente
    op.add_column(
        'favoritequestion',
        sa.Column('user_id', sa.String(), nullable=True)
    )

    # 3. Tornar session_id nullable
    op.alter_column(
        'favoritequestion',
        'session_id',
        existing_type=sa.String(length=64),
        nullable=True
    )

    # 4. Adicionar FK de user_id → user.id
    op.create_foreign_key(
        'fk_favoritequestion_user_id',
        'favoritequestion', 'user',
        ['user_id'], ['id'],
        ondelete='CASCADE'
    )

    # 5. Índice em user_id para queries de listagem
    op.create_index('ix_favoritequestion_user_id', 'favoritequestion', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_favoritequestion_user_id', table_name='favoritequestion')
    op.drop_constraint('fk_favoritequestion_user_id', 'favoritequestion', type_='foreignkey')
    op.alter_column('favoritequestion', 'session_id', nullable=False)
    op.drop_column('favoritequestion', 'user_id')
    op.drop_index('ix_user_email', table_name='user')
    op.drop_table('user')
