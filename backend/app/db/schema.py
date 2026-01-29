import os

try:
    from ..schema_validator import SchemaValidator
except ImportError:
    # Handle case when running as script directly
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from schema_validator import SchemaValidator

__all__ = ['SchemaValidator']
