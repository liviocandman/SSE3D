"""Initial revision

Revision ID: 001
Revises: 
Create Date: 2025-01-01 12:00:00

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'favoritequestion',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.String(length=64), nullable=False),
        sa.Column('body_id', sa.String(length=10), nullable=False),
        sa.Column('body_name', sa.String(length=50), nullable=False),
        sa.Column('question', sa.String(length=500), nullable=False),
        sa.Column('answer', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_favoritequestion_session_id', 'favoritequestion', ['session_id'], unique=False)

def downgrade() -> None:
    op.drop_index('ix_favoritequestion_session_id', table_name='favoritequestion')
    op.drop_table('favoritequestion')
