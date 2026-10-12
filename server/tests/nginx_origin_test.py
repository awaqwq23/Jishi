import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).parents[1] / 'deploy/native/prepare-nginx-origin.py'
spec = importlib.util.spec_from_file_location('nginx_origin', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class OriginProxyTest(unittest.TestCase):
    def test_api_transport_host_preserves_tls_web_host_and_browser_origin(self):
        original = '''server {
listen 443 ssl;
ssl_certificate /etc/letsencrypt/live/example/fullchain.pem;
location /api/ {
 proxy_set_header Host $host;
 proxy_set_header Origin $http_origin;
 proxy_pass http://127.0.0.1:8787;
}
location / { proxy_set_header Host $host; proxy_pass http://127.0.0.1:3000; }
}'''
        changed, count = module.patch_config(original)
        self.assertEqual(count, 1)
        self.assertIn('Host 127.0.0.1:8787;', changed)
        self.assertIn('X-Forwarded-Host $host;', changed)
        self.assertIn('Origin $http_origin;', changed)
        self.assertIn('ssl_certificate /etc/letsencrypt/live/example/fullchain.pem;', changed)
        self.assertIn('location / { proxy_set_header Host $host;', changed)
        self.assertEqual(module.patch_config(changed), (changed, 0))

    def test_unrecognized_proxy_host_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            module.patch_config('location /api/ { proxy_set_header Host unexpected; proxy_pass http://127.0.0.1:8787; }')

    def test_both_checked_in_sites_preserve_auth_api_and_health_origins(self):
        for name in ('nginx-jishi.conf','nginx-jishi-subdomain.conf'):
            text=(path.parent/name).read_text()
            _, count=module.patch_config(text)
            self.assertEqual(count,0)
            self.assertEqual(text.count('proxy_set_header Host 127.0.0.1:8787;'),3)
            self.assertEqual(text.count('proxy_set_header X-Forwarded-Host $host;'),3)

if __name__ == '__main__':
    unittest.main()
