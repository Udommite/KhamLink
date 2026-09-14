"""Initial source, curated, derived-index, feedback, and audit storage boundaries.

Revision ID: 0001
"""

from alembic import op
from khamlink.db import ActiveRelease, Base
from sqlalchemy import insert

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(bind=op.get_bind())
    op.get_bind().execute(insert(ActiveRelease).values(id=1, revision=0))


def downgrade():
    # Intentionally no destructive automatic downgrade; restore a verified DB backup.
    raise RuntimeError("Restore a verified backup; automated source-data destruction is disabled")
