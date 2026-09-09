import urllib.request,urllib.parse,http.cookiejar,re,json,hashlib,datetime,zipfile
from pathlib import Path
R=Path(__file__).resolve().parents[3]/'design/mission-frontier/assets/staging/cinematic-v1/astra/sources';R.mkdir(parents=True,exist_ok=True)
records=[]
for slug in ['modular-sci-fi-megakit','stylized-nature-megakit']:
 op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));u='https://quaternius.itch.io/'+slug;s=op.open(u+'/purchase').read().decode();csrf=re.search(r'name="csrf_token" value="([^"]+)',s).group(1)
 def post(url,data):return json.loads(op.open(urllib.request.Request(url,data=urllib.parse.urlencode(data).encode(),headers={'Referer':u+'/purchase','X-Requested-With':'XMLHttpRequest'})).read())
 url=post(u+'/download_url',{'csrf_token':csrf})['url'];page=op.open(url).read().decode();upload=re.search(r'data-upload_id="(\d+)',page).group(1);csrf=re.search(r'name="csrf_token" value="([^"]+)',page).group(1);d=post(u+'/file/'+upload+'?source=game_download',{'csrf_token':csrf});z=R/(slug+'-standard.zip')
 with op.open(d['url']) as src,z.open('wb') as dst:
  while b:=src.read(1024*1024):dst.write(b)
 with zipfile.ZipFile(z) as f:f.extractall(R/slug)
 records.append({'publisherUrl':u,'downloadDateUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'edition':'Free Standard','uploadId':upload,'archive':z.name,'sha256':hashlib.sha256(z.read_bytes()).hexdigest(),'bytes':z.stat().st_size,'license':'CC0 as stated on publisher page retained alongside archive'})
 print(slug,z.stat().st_size,flush=True)
(R/'acquisition.json').write_text(json.dumps(records,indent=2)+'\n')
