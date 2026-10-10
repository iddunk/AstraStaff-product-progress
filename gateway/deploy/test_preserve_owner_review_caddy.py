import importlib.util
from pathlib import Path
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('preserver', DIRECTORY / 'preserve-owner-review-caddy.py')
preserver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preserver)
LEGACY = (DIRECTORY / 'legacy-caddy.fixture').read_text(encoding='utf-8')
FRAGMENT = (DIRECTORY / 'owner-review.caddy').read_text(encoding='utf-8')


class OwnerRoutePreservation(unittest.TestCase):
    def test_old_deploy_preserves_all_existing_routes_and_is_idempotent(self):
        generated = preserver.render(LEGACY, FRAGMENT)
        self.assertEqual(generated.replace(preserver.IMPORT, ''), LEGACY)
        self.assertEqual(generated.count(preserver.IMPORT), 1)
        self.assertEqual(preserver.render(generated, FRAGMENT), generated)
        for route in ('/api/v1/webhooks/dingtalk', '/api/v1/channel-artifact-access',
                      '/browser-login/*', '/realms/*', '/resources/*', '127.0.0.1:3000'):
            self.assertIn(route, generated)

    def test_known_inline_route_is_preserved_without_duplicate(self):
        inline = LEGACY.replace('  encode gzip\n', '  encode gzip\n' + FRAGMENT)
        self.assertEqual(preserver.render(inline, FRAGMENT), inline)

    def test_conflicts_and_unexpected_fragment_fail_closed(self):
        for fragment in (FRAGMENT + 'handle /other { respond 200 }',
                         FRAGMENT.replace('4188', '4189')):
            with self.assertRaises(ValueError):
                preserver.render(LEGACY, fragment)
        conflict = LEGACY.replace('  encode gzip\n', '  encode gzip\n' + FRAGMENT.replace('4188', '4189'))
        with self.assertRaises(ValueError):
            preserver.render(conflict, FRAGMENT)
        with self.assertRaises(ValueError):
            preserver.render(LEGACY + '  encode gzip\n', FRAGMENT)

    def test_validation_failure_keeps_original_and_removes_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            config, fragment = Path(directory) / 'Caddyfile', Path(directory) / 'owner.caddy'
            config.write_text(LEGACY, encoding='utf-8', newline='')
            fragment.write_text(FRAGMENT, encoding='utf-8', newline='')
            def reject(candidate):
                self.assertIn(preserver.IMPORT, candidate.read_text(encoding='utf-8'))
                raise ValueError('invalid Caddy')
            with self.assertRaises(ValueError):
                preserver.preserve(config, fragment, reject)
            self.assertEqual(config.read_bytes(), LEGACY.encode())
            self.assertEqual(len(list(Path(directory).iterdir())), 2)

    def test_validated_atomic_replace_and_absent_gateway(self):
        with tempfile.TemporaryDirectory() as directory:
            config, fragment = Path(directory) / 'Caddyfile', Path(directory) / 'owner.caddy'
            config.write_text(LEGACY, encoding='utf-8', newline='')
            self.assertFalse(preserver.preserve(config, fragment, lambda _: self.fail()))
            fragment.write_text(FRAGMENT, encoding='utf-8', newline='')
            calls = []
            self.assertTrue(preserver.preserve(config, fragment, lambda candidate: calls.append(candidate)))
            self.assertEqual(len(calls), 1)
            self.assertEqual(config.read_text(encoding='utf-8').replace(preserver.IMPORT, ''), LEGACY)
            self.assertFalse(preserver.preserve(config, fragment, lambda _: self.fail()))

    def test_writer_race_does_not_overwrite_new_config(self):
        with tempfile.TemporaryDirectory() as directory:
            config, fragment = Path(directory) / 'Caddyfile', Path(directory) / 'owner.caddy'
            config.write_text(LEGACY, encoding='utf-8', newline='')
            fragment.write_text(FRAGMENT, encoding='utf-8', newline='')
            def change_during_validation(_):
                config.write_text('changed by another deployment', encoding='utf-8')
            with self.assertRaises(RuntimeError):
                preserver.preserve(config, fragment, change_during_validation)
            self.assertEqual(config.read_text(), 'changed by another deployment')

    def test_dropin_preserves_known_hook_and_write_boundary(self):
        dropin = (DIRECTORY / 'owner-review-caddy.conf').read_text()
        self.assertIn('ExecStartPre=+/usr/bin/python3 /opt/astrastaff/product-control/preserve-owner-review-caddy.py', dropin)
        self.assertIn('ReadWritePaths=/etc/astrastaff/caddy', dropin)


if __name__ == '__main__':
    unittest.main()
