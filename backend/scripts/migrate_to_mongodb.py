#!/usr/bin/env python3
"""
Migration script to move file-based storage to MongoDB.

Usage:
  python migrate_to_mongodb.py --dry-run     # Preview changes
  python migrate_to_mongodb.py --migrate     # Execute migration
  python migrate_to_mongodb.py --verify      # Verify migration
"""

import os
import sys
import argparse
import hashlib
from datetime import datetime

# Add project path
sys.path.insert(0, '/opt/webapps/zml/lists.zachlagden.uk/backend')

from bson import Binary


class Migrator:
    def __init__(self, dry_run=True):
        self.dry_run = dry_run
        self.data_dir = '/opt/webapps/zml/lists.zachlagden.uk/data'
        self.stats = {
            'users_migrated': 0,
            'users_skipped': 0,
            'default_migrated': False,
            'cache_entries_migrated': 0,
            'cache_entries_skipped': 0,
            'errors': []
        }
        self.app = None
        self.mongo = None

    def init_app(self):
        """Initialize Flask app and MongoDB connection."""
        from app import create_app
        from app.extensions import mongo

        self.app = create_app('production')
        self.mongo = mongo
        return self.app

    def migrate_user_configs(self):
        """Migrate all user configs to MongoDB."""
        users_dir = os.path.join(self.data_dir, 'users')

        if not os.path.exists(users_dir):
            print(f"Users directory not found: {users_dir}")
            return

        with self.app.app_context():
            for username in os.listdir(users_dir):
                user_config_dir = os.path.join(users_dir, username, 'config')
                if not os.path.isdir(user_config_dir):
                    continue

                # Read existing files
                blocklists = self._read_file(os.path.join(user_config_dir, 'blocklists.conf'))
                whitelist = self._read_file(os.path.join(user_config_dir, 'whitelist.txt'))

                if blocklists is None and whitelist is None:
                    self.stats['users_skipped'] += 1
                    continue

                # Find user in MongoDB
                user = self.mongo.db.users.find_one({'username': username})
                if not user:
                    self.stats['errors'].append(f"User not found in DB: {username}")
                    continue

                # Update user document
                update = {
                    '$set': {
                        'config.version': 1,
                        'config.migrated_at': datetime.utcnow()
                    }
                }
                if blocklists is not None:
                    update['$set']['config.blocklists'] = blocklists
                if whitelist is not None:
                    update['$set']['config.whitelist'] = whitelist

                if not self.dry_run:
                    self.mongo.db.users.update_one({'_id': user['_id']}, update)

                self.stats['users_migrated'] += 1
                print(f"[{'DRY-RUN' if self.dry_run else 'MIGRATED'}] User: {username}")

    def migrate_default_config(self):
        """Migrate default config to system_config collection."""
        default_config_dir = os.path.join(self.data_dir, 'default', 'config')

        blocklists = self._read_file(os.path.join(default_config_dir, 'blocklists.conf'))
        whitelist = self._read_file(os.path.join(default_config_dir, 'whitelist.txt'))

        if blocklists is None and whitelist is None:
            print("No default config files found")
            return

        with self.app.app_context():
            doc = {
                '_id': 'default_config',
                'blocklists': blocklists or '',
                'whitelist': whitelist or '',
                'migrated_at': datetime.utcnow(),
                'updated_by': 'migration_script'
            }

            if not self.dry_run:
                self.mongo.db.system_config.replace_one(
                    {'_id': 'default_config'},
                    doc,
                    upsert=True
                )

            self.stats['default_migrated'] = True
            print(f"[{'DRY-RUN' if self.dry_run else 'MIGRATED'}] Default config")

    def migrate_cache_content(self):
        """Migrate cache content to MongoDB."""
        cache_dir = os.path.join(self.data_dir, 'cache')

        if not os.path.exists(cache_dir):
            print(f"Cache directory not found: {cache_dir}")
            return

        with self.app.app_context():
            for url_hash in os.listdir(cache_dir):
                entry_dir = os.path.join(cache_dir, url_hash)
                if not os.path.isdir(entry_dir):
                    continue

                content_path = os.path.join(entry_dir, 'content.txt')
                if not os.path.exists(content_path):
                    self.stats['cache_entries_skipped'] += 1
                    continue

                # Read content as binary
                with open(content_path, 'rb') as f:
                    content = f.read()

                # Check size (16MB limit minus overhead)
                if len(content) > 15_000_000:
                    self.stats['errors'].append(f"Content too large: {url_hash} ({len(content)} bytes)")
                    continue

                # Try to get existing metadata from old collection
                existing = self.mongo.db.cache_metadata.find_one({'url_hash': url_hash})

                if not self.dry_run:
                    # Prepare update document
                    update_doc = {
                        'url_hash': url_hash,
                        'content': Binary(content),
                        'content_hash': hashlib.sha256(content).hexdigest(),
                        'stats.size_bytes': len(content),
                        'migrated_at': datetime.utcnow()
                    }

                    # Copy over existing metadata if available
                    if existing:
                        update_doc['url'] = existing.get('url', '')
                        update_doc['etag'] = existing.get('etag')
                        update_doc['last_modified'] = existing.get('last_modified')
                        if existing.get('stats'):
                            update_doc['stats.domain_count'] = existing['stats'].get('domain_count', 0)
                            update_doc['stats.download_count'] = existing['stats'].get('download_count', 0)
                            update_doc['stats.last_download_at'] = existing['stats'].get('last_download_at')

                    self.mongo.db.cache.update_one(
                        {'url_hash': url_hash},
                        {'$set': update_doc},
                        upsert=True
                    )

                self.stats['cache_entries_migrated'] += 1
                size_kb = len(content) / 1024
                print(f"[{'DRY-RUN' if self.dry_run else 'MIGRATED'}] Cache: {url_hash[:16]}... ({size_kb:.1f} KB)")

    def verify_migration(self):
        """Verify migration was successful."""
        with self.app.app_context():
            # Check users
            users_with_config = self.mongo.db.users.count_documents({'config': {'$exists': True}})
            total_users = self.mongo.db.users.count_documents({})
            print(f"Users with embedded config: {users_with_config}/{total_users}")

            # Check default
            default = self.mongo.db.system_config.find_one({'_id': 'default_config'})
            print(f"Default config exists: {default is not None}")
            if default:
                print(f"  - Blocklists length: {len(default.get('blocklists', ''))}")
                print(f"  - Whitelist length: {len(default.get('whitelist', ''))}")

            # Check cache
            cache_with_content = self.mongo.db.cache.count_documents({'content': {'$exists': True}})
            print(f"Cache entries with content: {cache_with_content}")

            # Calculate total cache size
            pipeline = [
                {'$match': {'content': {'$exists': True}}},
                {'$group': {'_id': None, 'total': {'$sum': '$stats.size_bytes'}}}
            ]
            result = list(self.mongo.db.cache.aggregate(pipeline))
            total_size = result[0]['total'] if result else 0
            print(f"Total cache size: {total_size / (1024*1024):.2f} MB")

    def _read_file(self, path):
        """Read file if it exists."""
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()
        return None

    def print_stats(self):
        """Print migration statistics."""
        print("\n=== Migration Statistics ===")
        print(f"Users migrated: {self.stats['users_migrated']}")
        print(f"Users skipped (no config): {self.stats['users_skipped']}")
        print(f"Default config migrated: {self.stats['default_migrated']}")
        print(f"Cache entries migrated: {self.stats['cache_entries_migrated']}")
        print(f"Cache entries skipped: {self.stats['cache_entries_skipped']}")
        if self.stats['errors']:
            print(f"Errors: {len(self.stats['errors'])}")
            for err in self.stats['errors']:
                print(f"  - {err}")


def main():
    parser = argparse.ArgumentParser(description='Migrate file storage to MongoDB')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--dry-run', action='store_true', help='Preview changes without modifying')
    group.add_argument('--migrate', action='store_true', help='Execute migration')
    group.add_argument('--verify', action='store_true', help='Verify migration')
    args = parser.parse_args()

    migrator = Migrator(dry_run=not args.migrate)
    migrator.init_app()

    if args.verify:
        migrator.verify_migration()
    else:
        print(f"{'DRY RUN - ' if migrator.dry_run else ''}Starting migration...")
        print("\n--- Migrating User Configs ---")
        migrator.migrate_user_configs()
        print("\n--- Migrating Default Config ---")
        migrator.migrate_default_config()
        print("\n--- Migrating Cache Content ---")
        migrator.migrate_cache_content()
        migrator.print_stats()

        if migrator.dry_run:
            print("\n[DRY RUN] No changes were made. Run with --migrate to execute.")


if __name__ == '__main__':
    main()
