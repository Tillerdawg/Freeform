import json, hashlib, pathlib, subprocess
root=pathlib.Path('evidence/m8-director/huffer-review/round2')
a=json.loads((root/'results-a.json').read_text()); b=json.loads((root/'results-b.json').read_text()); rows={r['name']:r for r in a}
checks=[]
def check(name,condition):
 assert condition,name
 checks.append(name)
for r,s in zip(a,b):
 check('fresh runtime '+r['name'],r.get('sha256')==s.get('sha256'))
check('same runtime static',rows['static']['sha256']==rows['static-repeat']['sha256'])
for name in ['multiline-note','crlf-note','multiline-title']:
 items=rows[name]['pages'][0]['items']; first=next(i for i in items if i['str']=='First line'); second=next(i for i in items if i['str']=='Second line')
 check(name+' separate baselines',first['transform'][5]>second['transform'][5])
for name,code in [('long-note','note-layout-overflow'),('long-title','writer-failed'),('offpage-rank','writer-failed'),('included-glyph','unsupported-glyph'),('range-reversed','validation-failed'),('range-outside','validation-failed')]:
 check(name+' classified',rows[name]['code']==code)
check('excluded glyph success',rows['excluded-glyph']['ok'])
check('actual rank overlap',len(rows['rank-actual-overlap']['warnings'])==1 and rows['rank-actual-overlap']['warnings'][0]['obstacleBounds']=={'x':291,'y':299,'width':5.1,'height':5.74})
check('below and edge controls',not rows['rank-false-overlap']['warnings'] and not rows['rank-edge-touch']['warnings'])
check('no transitions multi/single',len(rows['transitionless-multi']['pages'])==3 and len(rows['transitionless-single']['pages'])==1)
check('range pages',len(rows['range']['pages'])==5)
for name in ['float','range','all-marks']:
 for index,p in enumerate(rows[name]['pages']):
  text=''.join(i['str'] for i in p['items'])
  check(name+' footer '+str(index),'Page '+str(index+1)+' of '+str(len(rows[name]['pages'])) in text)
for index,p in enumerate(rows['all-marks']['pages']):
 text=''.join(i['str'] for i in p['items']); check('scope '+str(index),('SET ONLY'in text)==(index==0) and ('TRANSITION ONLY'in text)==(index>=2) and 'SHOW MARK'in text)
check('only moved warning removed',len(rows['overlap-before']['warnings'])==4 and len(rows['overlap-after']['warnings'])==2 and all(w['annotationId']=='a-note' for w in rows['overlap-after']['warnings']))
for name in ['overlap-before','overlap-after']:
 w=rows[name]['warnings'];check(name+' sorted',w==sorted(w,key=lambda w:(w['pageIndex'],w['annotationId'],w['performerId'],w['obstacleKind'])))
items=rows['whitespace']['pages'][0]['items']; keep=next(i for i in items if i['str']=='Keep'); spaces=next(i for i in items if i['str']=='spaces')
check('leading spaces retained',abs(keep['transform'][4]-343.68)<.01)
check('repeated spaces retained',abs(spaces['transform'][4]-keep['transform'][4]-28.278)<.01)
check('no snapshot changes',all(r['unchanged'] for r in a))
foundation=json.loads(pathlib.Path('evidence/m8-pdf-foundation/recovery-r2/huffer-review/identity.json').read_text())
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
hashes={p:sha(p) for p in foundation['sourceHashes']}; delta=[p for p,v in hashes.items() if v!=foundation['sourceHashes'][p]]
check('source delta allowed',set(delta)=={'src/pdf/pdf-export.ts','src/pdf/contracts.ts','src/pdf/pdf-export.test.ts'})
identity={'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'branch':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),'sourceHashes':hashes,'foundationDelta':delta,'trackedDiffSha256':hashlib.sha256(subprocess.check_output(['git','diff'])).hexdigest(),'dirtyTreeNotHead':True}
(root/'identity.json').write_text(json.dumps(identity,indent=2));(root/'assertions.json').write_text(json.dumps({'checks':checks,'staticSha256':rows['static']['sha256'],'count':len(checks),'mixedFontRotationDefect':{'interiorActualOrigins':[[236,377],[249.419,377]],'interiorExpectedOrigins':[[236,377],[236,390.419]],'edgeActualEmojiOrigin':[800.72998046875,302],'pageWidth':792,'exportReportedSuccess':rows['mixed-edge-symbol']['ok']},'authoringControls':['Initial long title exceeded schema200; replaced with valid120-character multiline overflow. Combining rank is schema-invalid, not a renderer finding. Initial read-only summary one-liner SyntaxError corrected; renderer probe itself exits0.']},indent=2));print(json.dumps({'checks':len(checks),'sourceDelta':delta,'staticSha256':rows['static']['sha256']},indent=2))
