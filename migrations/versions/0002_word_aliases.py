"""Alternative written forms for one source entry.

Revision ID: 0002
"""

from alembic import op
from khamlink.db import WordAlias

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    WordAlias.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError("Restore a verified backup; automated source-data destruction is disabled")
