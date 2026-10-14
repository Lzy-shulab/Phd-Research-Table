"""Publish the source and the three Windows release assets without persisting credentials."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import urllib.error
import urllib.parse

workspace = Path(__file__).resolve().parent.parent
version = json.loads((workspace / 'package.json').read_text(encoding='utf-8-sig'))['version']
repository = 'Lzy-shulab/Phd-Research-Table'
evidence = workspace / 'test-results' / f'fixes-{version}' / 'publish'
evidence.mkdir(parents=True, exist_ok=True)
checkout = evidence / 'repo'
credential = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True)
credential_fields = dict(line.split('=', 1) for line in credential.stdout.splitlines() if '=' in line)
token = credential_fields.get('password')
if not token:
    raise RuntimeError('GitHub credential helper returned no credential')
proxy_url = os.environ.get('WORKBENCH_PUBLISH_PROXY', '')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url} if proxy_url else {}))
headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'PhD-Workbench-Publisher', 'X-GitHub-Api-Version': '2022-11-28'}

def api(path, method='GET', body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(f'https://api.github.com/repos/{repository}/{path}'.rstrip('/'), data=data, headers={**headers, 'Content-Type': 'application/json'}, method=method)
    with opener.open(request, timeout=60) as response:
        return json.load(response)

def inspect():
    repo = api('')
    latest = api('releases/latest')
    print(json.dumps({'repository': repo['full_name'], 'branch': repo['default_branch'], 'latest': latest['tag_name'], 'assets': [asset['name'] for asset in latest['assets']]}, ensure_ascii=False))

def sync():
    if not (checkout / '.git').exists():
        raise RuntimeError('Create a clean source checkout before publishing')
    excluded = {'node_modules', 'out', 'release', 'test-results', 'delete', '工作台数据', '.git'}
    files = []
    for root, directories, names in os.walk(workspace):
        directories[:] = [name for name in directories if name not in excluded and not name.startswith('release-stage-')]
        for name in names:
            path = Path(root) / name
            if name.startswith('.env') and name != '.env.example':
                continue
            if path.suffix.lower() in {'.sqlite', '.db', '.log'} or '.sqlite-' in name or '.db-' in name:
                continue
            relative = path.relative_to(workspace)
            target = checkout / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            if target.read_bytes() != path.read_bytes():
                raise RuntimeError(f'Source content mismatch: {relative}')
            files.append(relative.as_posix())
    tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=checkout, capture_output=True, check=True).stdout.decode().split('\0')
    for name in tracked:
        if name and name not in files and (checkout / name).exists():
            archived = evidence / 'removed-source' / name
            archived.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(checkout / name), archived)
    with (evidence / 'git.log').open('a', encoding='utf-8') as log:
        for args in [['git', 'add', '-A'], ['git', 'commit', '-m', f'Fix attendance deductions, settings alignment and in-app updates for v{version}'],
                     ['git', '-c', 'http.proxy=', '-c', 'https.proxy=', 'push', 'origin', 'main']]:
            subprocess.run(args, cwd=checkout, stdout=log, stderr=log, check=True)
    print(f'SOURCE_PUSHED files={len(files)} version={version}')

def publish():
    notes = f'''PhD 科研工作台 v{version}

- 出差与休假按每天 12 小时从周、月打卡目标中扣除，周末和节假日同样计算；日历显示日期标记。
- 统一设置页图标、标题和操作按钮的对齐，改善大字体和窄窗口布局。
- 支持应用内下载更新包，重启后自动替换程序文件并重新打开工作台。
- 精修工作区图标，改善页面切换、Dock、任务详情和弹层动效。'''
    release = next((item for item in api('releases?per_page=30') if item['tag_name'] == f'v{version}'), None)
    if release is None:
        release = api('releases', 'POST', {'tag_name': f'v{version}', 'target_commitish': 'main', 'name': f'PhD 科研工作台 v{version}', 'body': notes, 'draft': True, 'prerelease': False})
    paths = [workspace / 'release' / f'PhD-Research-Workbench-{version}-Setup.exe',
             workspace / 'test-results' / f'fixes-{version}' / 'update-assets' / f'PhD-Research-Workbench-{version}-Update.zip',
             workspace / 'test-results' / f'fixes-{version}' / 'update-assets' / 'latest-update.json']
    import http.client
    for path in paths:
        existing = next((item for item in release['assets'] if item['name'] == path.name), None)
        if existing:
            if existing['state'] == 'uploaded' and existing['size'] == path.stat().st_size:
                print(f'ASSET_ALREADY_UPLOADED {path.name}', flush=True)
                continue
            raise RuntimeError(f'Incomplete existing asset: {path.name}')
        if proxy_url:
            proxy = urllib.parse.urlparse(proxy_url)
            connection = http.client.HTTPSConnection(proxy.hostname, proxy.port, timeout=300)
            connection.set_tunnel('uploads.github.com', 443)
        else:
            connection = http.client.HTTPSConnection('uploads.github.com', timeout=300)
        upload_path = f'/repos/{repository}/releases/{release["id"]}/assets?name={urllib.parse.quote(path.name)}'
        connection.putrequest('POST', upload_path)
        for key, value in {**headers, 'Content-Type': 'application/octet-stream', 'Content-Length': str(path.stat().st_size)}.items():
            connection.putheader(key, value)
        connection.endheaders()
        with path.open('rb') as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                connection.send(block)
        response = connection.getresponse()
        if response.status != 201:
            raise RuntimeError(f'GitHub upload failed: HTTP {response.status}')
        asset = json.loads(response.read())
        if asset['state'] != 'uploaded' or asset['size'] != path.stat().st_size:
            raise RuntimeError('GitHub asset upload incomplete')
        print(f'ASSET_UPLOADED {path.name}', flush=True)
        connection.close()
    published = api(f'releases/{release["id"]}', 'PATCH', {'draft': False, 'make_latest': 'true'})
    latest = api('releases/latest')
    assert latest['tag_name'] == f'v{version}'
    remote_package = api('contents/package.json?ref=main')
    import base64
    assert json.loads(base64.b64decode(remote_package['content']))['version'] == version
    result = {'version': version, 'url': published['html_url'], 'sourceFilesCompared': True,
              'assets': [{'name': item['name'], 'size': item['size'], 'state': item['state']} for item in latest['assets']]}
    (evidence / 'publication.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))

parser = argparse.ArgumentParser()
parser.add_argument('operation', choices=['inspect', 'sync', 'publish'])
globals()[parser.parse_args().operation]()
