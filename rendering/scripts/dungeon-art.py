"""Assemble Dungeon Board generated artwork. Run from repository root.

All raw sources and private-reference comparisons stay in ignored artifacts.
The PNG/JSON atlases, prompts, this build/check script and ASSETS.md are deliverables.
"""
from PIL import Image, ImageDraw, ImageChops, ImageFilter, ImageFont, ImageCms
from pathlib import Path
import json, math, re, argparse, os, shutil, statistics

LIVE = Path('rendering/src/assets/dungeon')
OUT = Path('rendering/artifacts/dungeon/v6/staging')
ART = Path('rendering/artifacts/dungeon')
RESAMPLE = Image.Resampling.LANCZOS
SHEETS = {}
SPRITES = {}
META = {}

def clean(im, threshold=12):
    """Remove near-invisible noise and zero RGB of transparent pixels."""
    im = im.convert('RGBA')
    data = []
    for r,g,b,a in im.getdata():
        data.append((0,0,0,0) if a < threshold else (r,g,b,255 if a >= 240 else a))
    im.putdata(data)
    return im

def prune_micro(im):
    """Discard detached one/two-pixel alpha components after resampling."""
    w,h=im.size;data=list(im.getdata());mask=bytearray(1 if p[3] else 0 for p in data);drop=set()
    def adjacent(k):
        x=k%w;y=k//w;out=[]
        if x and mask[k-1]:out.append(k-1)
        if x<w-1 and mask[k+1]:out.append(k+1)
        if y and mask[k-w]:out.append(k-w)
        if y<h-1 and mask[k+w]:out.append(k+w)
        return out
    for k,a in enumerate(mask):
        if not a:continue
        neighbours=adjacent(k)
        if not neighbours:drop.add(k)
        elif len(neighbours)==1 and len(adjacent(neighbours[0]))==1:drop.update([k,neighbours[0]])
    for k in drop:data[k]=(0,0,0,0)
    im=im.copy();im.putdata(data);return im

def trim(im):
    im = clean(im)
    # Generation did not always honour cell gutters. Retain substantial
    # connected silhouettes, removing neighbour fragments and tiny alpha dust.
    w,h=im.size; alpha=im.getchannel('A');mask=bytearray(1 if a else 0 for a in alpha.getdata());components=[]
    for root in range(w*h):
        if mask[root]!=1:continue
        mask[root]=2;todo=[root];component=[]
        while todo:
            q=todo.pop();component.append(q);x=q%w;y=q//w
            for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if 0<=nx<w and 0<=ny<h:
                    k=ny*w+nx
                    if mask[k]==1:mask[k]=2;todo.append(k)
        components.append(component)
    if components:
        cutoff=max(6,max(map(len,components))*.10)
        ap=list(alpha.getdata())
        for c in components:
            if len(c)<cutoff:
                for k in c:ap[k]=0
        alpha.putdata(ap);im.putalpha(alpha);im=clean(im)
    box = im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
    if not box: raise ValueError('empty source')
    return im.crop((max(0,box[0]-2),max(0,box[1]-2),min(im.width,box[2]+2),min(im.height,box[3]+2)))

def source(key, cols, rows):
    im = Image.open(ART/(key+'-raw.png')).convert('RGBA')
    cells=[]
    for y in range(rows):
        for x in range(cols):
            cells.append(trim(im.crop((round(x*im.width/cols),round(y*im.height/rows),round((x+1)*im.width/cols),round((y+1)*im.height/rows)))))
    if key=='alcove':
        # Labels were not aligned to the requested grid: the larger plaque
        # begins 30px before its cell. Explicit whole-object crops avoid
        # including its left edge as a detached fragment of the small label.
        cells[4]=trim(im.crop((535,697,929,843)))
        cells[5]=trim(im.crop((984,649,1535,887)))
    return cells

def fit(im, size, exact=False):
    im = im.copy()
    if exact: return clean(im.resize(size,RESAMPLE))
    im.thumbnail(size,RESAMPLE)
    return clean(im)

def add(sheet,name,im,anchor='feet',**meta):
    im=clean(im)
    # Every non-tile frame has two transparent pixels inside its rectangle too.
    tile=meta.get('tile')
    if not tile:im=prune_micro(im)
    if tile:
        anchor='tl'
    else:
        canvas=Image.new('RGBA',(im.width+4,im.height+4))
        canvas.alpha_composite(im,(2,2));im=canvas
    if isinstance(anchor,tuple): a=anchor
    elif anchor=='feet': a=(im.width/2,im.height-2)
    elif anchor=='top': a=(im.width/2,2)
    elif anchor=='tl': a=(0,0)
    else: a=(im.width/2,im.height/2)
    info={'anchor':{'x':a[0],'y':a[1]},**meta}
    SHEETS.setdefault(sheet,[]).append((name,im,info))
    SPRITES[name]=im;META[name]=info

def periodic(im,axes,band=6):
    """Blend generated edge bands symmetrically, making opposite texels equal."""
    im=im.copy();px=im.load();w,h=im.size
    for axis in axes:
        n=min(band,(w if axis=='x' else h)//5)
        span=h if axis=='x' else w
        length=w if axis=='x' else h
        for j in range(span):
            p=(0,j) if axis=='x' else (j,0)
            q=(w-1,j) if axis=='x' else (j,h-1)
            avg=tuple(round((a+b)/2) for a,b in zip(px[p],px[q]))
            for k in range(n):
                weight=(1-k/n)**2
                for pos in [k,length-1-k]:
                    xy=(pos,j) if axis=='x' else (j,pos)
                    px[xy]=tuple(round(v*(1-weight)+t*weight) for v,t in zip(px[xy],avg))
    return im

def region(im,box):
    return im.crop(tuple(round(v*(im.width if i%2==0 else im.height)) for i,v in enumerate(box)))

def tint_body(im,color,drone=False):
    if color=='white':return im.copy()
    targets={'orange':(234,121,37),'blue':(22,155,232),'purple':(155,67,220),'green':(76,183,61),'yellow':(244,200,35),'red':(219,66,58),'grey':(133,145,159),'teal':(39,183,169),'pink':(231,110,174)}
    target=targets[color];out=im.copy();p=out.load();w,h=out.size
    for y in range(h):
        for x in range(w):
            r,g,b,a=p[x,y]
            # Protect entire visor / eyes and thruster areas. Dark outlines remain exact.
            visor=(.16 < x/w < .84 and (.32 if not drone else .48)<y/h<(.52 if not drone else .75) and min(r,g,b)>180)
            thruster=drone and (x/w<.22 or x/w>.78)
            bright=max(r,g,b);low=min(r,g,b)
            if a and not visor and not thruster and bright>90 and min(r,g,b)>60 and b>=g*.84 and r>=g*.86:
                lum=(r*.24+g*.56+b*.20)/255
                highlight=max(0,(lum-.90)/.10)*.60
                shade=min(1.15,.45+.85*lum)
                p[x,y]=tuple(min(255,round(t*shade*(1-highlight)+255*highlight)) for t in target)+(a,)
    return out

def emission(im,factor,kind='warm'):
    out=im.copy();data=[]
    for r,g,b,a in out.getdata():
        active=(r>b*1.22 and r>g*.9 and r>125) if kind=='warm' else ((b>r*1.1 or (r>b*.75 and b>g*1.25)) and b>100)
        data.append(tuple(min(255,round(v*factor)) for v in (r,g,b))+(a,) if active else (r,g,b,a))
    out.putdata(data);return out

def animate(sheet,name,im,count=4,kind='warm',anchor='feet',fps=5):
    for i in range(count):
        frame=emission(im,[1,.88,1.13,.96][i],kind)
        if name=='magic-circle':
            # Light travels round the painted ring; geometry remains registered.
            data=[]
            for y in range(frame.height):
                for x in range(frame.width):
                    r,g,b,a=frame.getpixel((x,y));angle=math.atan2(y-frame.height/2,x-frame.width/2)
                    light=.84+.16*math.cos(angle-i*math.pi/2)
                    data.append((round(r*light),round(g*light),round(b*light),a))
            frame.putdata(data)
        if name=='alchemy-tank':
            d=ImageDraw.Draw(frame)
            for j in range(3):
                x=round(frame.width*(.42+j*.09));y=round(frame.height*(.69-((i+j)%4)*.075))
                d.ellipse((x-2,y-3,x+2,y+3),outline=(238,188,255,220),width=1)
        add(sheet,f'{name}-{i}',frame,anchor,fps=fps if i==0 else None)

# V2 source rectangles include the complete connected silhouette, even where
# the generator placed it across a requested grid boundary.
_grid_source = source
def source(key,cols=1,rows=1):
    if not key.startswith('v2-'):return _grid_source(key,cols,rows)
    crops_path=ART/'v2/source-crops.json'
    if crops_path.exists():boxes=json.loads(crops_path.read_text())[key]
    else:boxes=json.loads((LIVE/'prompts.json').read_text())['v2_generations'][key]['crops']
    im=Image.open(ART/'v2'/(key+'-raw.png')).convert('RGBA')
    return [trim(im.crop(b)) for b in boxes]

def stone_grade(im):
    """Restrained neutral periwinkle grade; warm bounce and outlines stay put."""
    result=[]
    for r,g,b,a in im.getdata():
        if b>r*1.06 and b>g*1.10 and max(r,g,b)>55:
            l=.25*r+.5*g+.25*b
            result.append((min(255,round(r*.88+l*.12+2)),min(255,round(g*.88+l*.12+4)),min(255,round(b*.88+l*.12)),a))
        else:result.append((r,g,b,a))
    out=im.copy();out.putdata(result);return out

def rectified(im):
    """Keep the source stone artwork while making repeated side walls parallel."""
    out=Image.new('RGBA',im.size)
    for y in range(im.height):
        row=im.crop((0,y,im.width,y+1));b=row.getchannel('A').point(lambda a:255 if a>40 else 0).getbbox()
        if b:out.alpha_composite(row.crop(b).resize((im.width,1),RESAMPLE),(0,y))
    return clean(out)

def flame_frames():
    frames=source('v2-flames');maxh=max(f.height for f in frames[:4])
    canvases=[]
    for f in frames[:4]:
        im=fit(f,(round(f.width*72/maxh),round(f.height*72/maxh)),True)
        can=Image.new('RGBA',(72,78));can.alpha_composite(im,((72-im.width)//2,76-im.height));canvases.append(can)
    return canvases,frames

def flame_animation(sheet,name,body,can_size,body_pos,fire_pos,fire_size,count=4,anchor='feet'):
    flame,unused=flame_frames()
    for i in range(count):
        can=Image.new('RGBA',can_size);can.alpha_composite(body,body_pos)
        fire=fit(flame[i],fire_size,True);can.alpha_composite(fire,fire_pos)
        add(sheet,f'{name}-{i}',can,anchor,**({'fps':7} if i==0 else {}))

def build_v2():
    robots=source('v2-robots');colors=['orange','white','blue','purple','green','yellow','red','grey','teal','pink']
    # 36 x 42 concept pixels, or 108 x 126 sheet pixels. Only a tight shared
    # registration canvas remains; the old wide robot margins are removed.
    for c in colors:
        for idx,im in enumerate(robots):
            drone=idx>=6
            im=fit(im,(45,30) if drone else (108,126),True)
            im=tint_body(im,c,drone)
            can=Image.new('RGBA',(49,34) if drone else (112,130));can.alpha_composite(im,(2,2))
            name=f'robot-{c}-idle-{idx}' if idx<2 else f'robot-{c}-work-{idx-2}' if idx<6 else f'drone-{c}-{idx-6}'
            add('robots',name,can,'centre' if drone else (58,130),**({'fps':2 if idx==0 else 6 if idx==2 else 4} if idx in [0,2,6] else {}))

    alc=source('v2-alcoves')
    for i in range(4):
        # Crop off the generated side reveals so adjacent slots are one recess,
        # not a line of little self-contained boxes. Keep the lit front ledge.
        interior=region(alc[i],(.055,.015,.945,.985))
        add('alcoves',f'alcove-slot-{i}',stone_grade(fit(interior,(120,246),True)),'tl')
    for i,n in [(4,'alcove-left'),(5,'alcove-right')]:add('alcoves',n,stone_grade(fit(alc[i],(66,279),True)),'tl')
    add('alcoves','alcove-top',periodic(stone_grade(fit(region(alc[6],(.03,.02,.97,.98)),(198,66),True)),'x'),'tl',tile='x')
    add('alcoves','alcove-ledge',periodic(stone_grade(fit(region(alc[7],(.03,.02,.97,.98)),(198,48),True)),'x'),'tl',tile='x')
    flame,fireparts=flame_frames()
    candle=fit(fireparts[6],(30,93))
    flame_animation('alcoves','candle',candle,(40,125),(5,30),(3,0),(34,39),count=3)

    ramp=source('v2-ramparts');back=source('v2-background');extra=source('v2-extra')
    for idx,n,size,axes in [(0,'rampart-x',(198,66),'x'),(1,'rampart-y',(66,198),'y')]:
        im=stone_grade(fit(ramp[idx],size,True))
        im=rectified(im) if axes=='y' else im
        add('stone',n,periodic(im,axes),'tl',tile=axes)
    for idx,n in [(2,'tl'),(3,'tr'),(4,'bl'),(5,'br')]:add('stone','rampart-corner-'+n,stone_grade(fit(ramp[idx],(198,198),True)),'tl')
    ends=[('left',6,(0,0,.34,1)),('right',7,(.66,0,1,1)),('top',8,(0,0,1,.34)),('bottom',9,(0,.66,1,1))]
    for n,idx,box in ends:add('stone','rampart-end-'+n,stone_grade(fit(region(ramp[idx],box),(66,66),True)),'tl')
    add('stone','rampart-t-down',stone_grade(fit(ramp[10],(198,132),True)),'tl')
    add('stone','rampart-return-left',stone_grade(fit(back[2],(144,144),True)),'tl')
    add('stone','rampart-return-right',stone_grade(fit(back[3],(144,144),True)),'tl')
    terrace=stone_grade(fit(region(ramp[11],(.025,.025,.975,.975)),(216,180),True));terrace.putalpha(255)
    add('stone','terrace-floor',periodic(terrace,'xy'),'tl',tile='xy')
    for idx,n in [(0,'wall-brick'),(1,'wall-brick-dark')]:
        im=stone_grade(fit(region(extra[idx],(.016,.018,.984,.982)),(480,228),True));im.putalpha(255)
        factor=.84 if idx==1 else .68
        im.putdata([(round(r*factor),round(g*factor),round(b*factor),a) for r,g,b,a in im.getdata()])
        add('stone',n,periodic(im,'xy',band=3),'tl',tile='xy')
    floor=stone_grade(fit(region(back[5],(.03,.03,.97,.97)),(216,132),True));floor.putalpha(255)
    add('stone','floor-flag',periodic(floor,'x'),'tl',tile='x')
    add('stone','ledge-face',periodic(stone_grade(fit(region(ramp[0],(.03,.40,.97,.96)),(198,42),True)),'x'),'tl',tile='x')
    for idx,n in [(6,'ledge-end-left'),(7,'ledge-end-right')]:add('stone',n,stone_grade(fit(ramp[idx],(198,66),True)),'tl')
    pillar=stone_grade(fit(region(alc[4],(.10,.25,.82,.74)),(66,132),True))
    add('stone','pillar',periodic(pillar,'y'),'tl',tile='y')
    add('stone','pillar-cap',stone_grade(fit(region(alc[4],(0,0,1,.26)),(84,66),True)),'tl')
    add('stone','pillar-base',stone_grade(fit(region(alc[4],(0,.76,1,1)),(84,66),True)))
    add('stone','window-barred',stone_grade(fit(back[4],(144,180))))
    add('stone','border',periodic(stone_grade(fit(ramp[0],(198,66),True)),'x'),'tl',tile='x')
    add('stone','border-corner',stone_grade(fit(ramp[2],(132,132),True)),'tl')

    gate=source('v2-gate');surround=source('v2-surround')[0];ui=source('v2-ui')
    add('gate','gate-surround',stone_grade(fit(surround,(990,684),True)))
    add('gate','gate-arch',stone_grade(fit(gate[0],(435,360),True)))
    animate('gate','gate-portcullis-lit',fit(gate[1],(255,246),True),fps=3)
    add('gate','gate-portcullis-dark',fit(gate[2],(255,246),True))
    add('gate','gate-medallion',stone_grade(fit(ui[3],(192,192),True)),'centre')
    for idx,n,size in [(3,'stairs-top',(360,150)),(4,'stairs-mid',(360,270)),(5,'stairs-bottom',(360,150))]:
        im=stone_grade(fit(gate[idx],size,True))
        if n=='stairs-mid':add('gate',n,periodic(rectified(im),'y'),'tl',tile='y')
        else:add('gate',n,im,'tl')
    add('gate','banner-crown',fit(gate[6],(132,198)),'top')
    add('stone','niche-arch',stone_grade(fit(gate[7],(198,240))))

    # Existing white pictograms are already compatible with the reference.
    glyph=source('ui',4,4);oldstone=source('stone',4,4)
    names=['layers','code','cube','chart','flask','person','gear','globe','book','terminal','database','rocket','shield','bolt','leaf','castle']
    add('ui','label',fit(ui[0],(360,105),True),'centre',slice={'left':36,'right':36,'top':24,'bottom':24})
    add('ui','plaque',fit(ui[1],(825,195),True),'centre',slice={'left':60,'right':60,'top':36,'bottom':36})
    add('ui','medallion',stone_grade(fit(ui[2],(165,165),True)),'centre')
    add('ui','panel',fit(ui[4],(570,138),True),'centre',slice={'left':39,'right':39,'top':30,'bottom':30})
    for n,im in zip(names,glyph):add('ui','icon-'+n,fit(im,(96,96)),'centre')
    add('ui','node',fit(region(oldstone[14],(.32,.03,.68,.97)),(36,36)),'centre')
    for n,idx in [('count-hosts',0),('count-projects',2),('count-workspaces',0)]:add('ui',n,fit(glyph[idx],(48,48)),'centre')
    icon=fit(robots[0],(48,48));a=icon.getchannel('A');icon=icon.convert('L').convert('RGBA');icon.putalpha(a);add('ui','count-agents',icon,'centre')

    pa=source('v2-propsA');pb=source('v2-propsB')
    # Real redrawn flames, all registered to the SAME holder geometry.
    torch=fit(pa[0],(45,99),True)
    flame_animation('props','torch',torch,(60,153),(8,50),(0,0),(60,67),anchor='top')
    unlit_body=torch.copy();unlit_body.putdata([(round(r*.48),round(g*.48),round(b*.58),a) for r,g,b,a in torch.getdata()])
    unlit=Image.new('RGBA',(60,153));unlit.alpha_composite(unlit_body,(8,50));add('props','torch-out',unlit,'top')
    brazier=stone_grade(fit(pa[1],(105,111),True))
    flame_animation('props','brazier',brazier,(117,180),(6,65),(0,0),(117,88))
    forge=stone_grade(fit(pa[10],(198,228),True))
    # A generated flame sits inside the existing dark firebox.
    for i,f in enumerate(flame):
        can=forge.copy();fire=fit(f,(84,105),True);can.alpha_composite(fire,(62,104));add('props',f'forge-{i}',can,'feet',**({'fps':7} if i==0 else {}))
    for n,idx,size in [('banner-navy-hammers',2,(156,264)),('banner-blue-anvil',3,(156,264)),('barrel',4,(87,105)),('barrels',5,(144,120)),('crate',6,(114,114)),('crates',7,(156,156)),('bookcase-ladder',8,(228,354)),('shelf-potions',9,(165,174)),('anvil',11,(144,108))]:add('props',n,fit(pa[idx],size),'top' if n.startswith('banner') else 'feet')
    for n,idx,size in [('banner-purple-layers',0,(156,264)),('banner-purple',1,(156,264)),('scroll-desk',6,(213,162)),('table',7,(180,120)),('rug-red',8,(228,120)),('cobweb',11,(132,132))]:add('props',n,fit(pb[idx],size),'top' if n.startswith('banner') or n=='cobweb' else 'feet')
    animate('props','crystal',fit(pb[2],(156,180)),kind='cool')
    animate('props','alchemy-tank',fit(pb[3],(174,240)),kind='cool')
    animate('props','magic-circle',fit(pb[4],(198,198)),kind='cool',anchor='centre')
    add('props','armor',fit(fireparts[4],(108,216)))
    add('props','chain',fit(fireparts[5],(33,180)),'top')
    add('props','portcullis-side',fit(fireparts[7],(144,180)))

    status=source('status',5,4)
    status_names=['mark-approval','mark-question','mark-failure','mark-done','mark-running','pr-ci-running','pr-ci-green','pr-ci-failing','pr-review-awaiting','pr-review-approved','pr-review-changes','pr-conflicts','probe-reviewing','probe-approved','probe-findings','probe-stale','probe-failed','seal-automerge']
    for i,n in enumerate(status_names):add('status',n,fit(status[i],(54,54) if i<5 else (60,60)),'centre')
    add('status','mark-asking',fit(extra[2],(54,54)),'centre')
    tints={'running':(247,190,37),'idle':(132,153,179),'done':(83,220,108),'approval':(255,168,46),'question':(63,168,247),'failure':(247,72,75),'offline':(114,111,130),'asking':(167,139,250)}
    for n,c in tints.items():
        glow=fit(extra[3] if n=='asking' else status[18],(126,48),True);data=[]
        for idx,(r,g,b,a) in enumerate(glow.getdata()):
            x=idx%glow.width;y=idx//glow.width;l=max(r,g,b)/255
            radius=math.hypot((x+.5-glow.width/2)/(glow.width/2),(y+.5-glow.height/2)/(glow.height/2));fade=max(0,1-radius*radius)**1.2
            data.append(tuple(round(v*(.5+.5*l)) for v in c)+(round(a*.65*fade),))
        glow.putdata(data);add('status','glow-'+n,glow,'centre')
    for n,c in [('online',(91,233,72)),('offline',(138,139,153)),('warning',(255,186,43))]:
        dot=fit(status[19],(24,24));data=[]
        for r,g,b,a in dot.getdata():
            data.append(tuple(round(v*(.4+.6*g/255)) for v in c)+(a,) if g>r*1.05 and g>b*1.15 else (r,g,b,a))
        dot.putdata(data);add('ui','dot-'+n,dot,'centre')

_v2_source=source
def source(key,cols=1,rows=1):
    if not key.startswith('v3-'):return _v2_source(key,cols,rows)
    cols,rows=(2,2) if key=='v3-rooms' else (3,1)
    im=Image.open(ART/'v3'/(key[3:]+'-raw.png')).convert('RGBA');parts=[]
    for y in range(rows):
        for x in range(cols):parts.append(trim(im.crop((round(x*im.width/cols),round(y*im.height/rows),round((x+1)*im.width/cols),round((y+1)*im.height/rows)))))
    return parts

_SRGB=ImageCms.createProfile('sRGB');_LAB=ImageCms.createProfile('LAB')
_TO_LAB=ImageCms.buildTransformFromOpenProfiles(_SRGB,_LAB,'RGB','LAB')
_TO_RGB=ImageCms.buildTransformFromOpenProfiles(_LAB,_SRGB,'LAB','RGB')
_STONE_REGIONS=[(0,126,45,420),(165,243,270,267),(377,308,386,419),(423,125,447,208),(521,94,675,156),(0,435,520,483),(680,434,1199,485),(270,158,303,215)]

def stone_pixel(r,g,b):
    return min(r,g,b)>5 and max(r,g,b)<248 and b>=r*.94 and b>=g*1.07 and b<=r*1.75 and r<=g*1.6 and b<=g*2.15

def luminance_bucket(l):return 0 if l<58 else 1 if l<100 else 2 if l<165 else 3

def lab_stats(values):
    out=[]
    for rows in values:
        if not rows:out.append(None);continue
        m=[statistics.mean(p[k] for p in rows) for k in range(3)]
        sd=[math.sqrt(statistics.mean((p[k]-m[k])**2 for p in rows)) for k in range(3)]
        out.append({'count':len(rows),'mean':m,'std':sd,'median':[statistics.median(p[k] for p in rows) for k in range(3)]})
    return out

def reference_model():
    ref=Path('design/references/dungeon-concept.png')
    if not ref.exists():return json.loads((LIVE/'prompts.json').read_text())['v3_colour_transfer']
    ref=Image.open(ref).convert('RGB');values=[[],[],[],[]]
    for b in _STONE_REGIONS:
        rgb=ref.crop(b);lab=ImageCms.applyTransform(rgb,_TO_LAB)
        for p,q in zip(rgb.getdata(),lab.getdata()):
            # Sample cool stone, excluding its pink/amber torch reflections.
            if stone_pixel(*p) and p[0]<=p[1]*(1.35 if q[0]<58 else 1.22) and p[2]>=p[0]*1.10:values[luminance_bucket(q[0])].append(q)
    return {'method':'Conditional CIELab a/b mean and standard-deviation match per sheet, interpolated over L; L and alpha held fixed','sample_regions':_STONE_REGIONS,'strata':['mortar','brick','mid faces','lit faces'],'reference':lab_stats(values),'encoding':'8-bit Lab: L*=L*100/255; a*=a-128; b*=b-128','sheets':{}}

def should_tone(sheet,name):
    if sheet in ['stone','gate','alcoves']:return True
    if sheet=='ui':return name=='medallion'
    return sheet=='props' and (name=='anvil' or any(name.startswith(n+'-') for n in ['brazier','forge','crystal','alchemy-tank']))

def colour_match():
    model=reference_model();model['sheets']={};target=model['reference']
    for sheet,frames in SHEETS.items():
        chosen=[(n,im,info) for n,im,info in frames if should_tone(sheet,n)]
        if not chosen:continue
        values=[[],[],[],[]];lab_images={}
        for n,im,info in chosen:
            lab=ImageCms.applyTransform(im.convert('RGB'),_TO_LAB);lab_images[n]=lab
            for idx,(p,q) in enumerate(zip(im.getdata(),lab.getdata())):
                if idx%7==0 and p[3]>128 and stone_pixel(*p[:3]):values[luminance_bucket(q[0])].append(q)
        src=lab_stats(values);parameters=[]
        for i,s in enumerate(src):
            s=s or next(v for v in src if v);t=target[i]
            gains=[1]+[max(.85,min(1.20,t['std'][k]/max(1,s['std'][k]))) for k in [1,2]]
            shifts=[0]+[max(-16,min(16,t['mean'][k]-s['mean'][k])) for k in [1,2]]
            parameters.append({'L':s['mean'][0],'source_mean':s['mean'],'gain':gains,'shift':shifts})
        centers=[p['L'] for p in parameters];updated={};delta=[];after=[[],[],[],[]];count=0
        for n,im,info in chosen:
            lab=lab_images[n];ld=list(lab.getdata());orig=list(im.getdata());mask=bytearray(len(orig))
            for idx,((r,g,b,a),(l,aa,bb)) in enumerate(zip(orig,ld)):
                if not a or l<22 or not stone_pixel(r,g,b):continue
                j=0
                while j<2 and l>centers[j+1]:j+=1
                if l<=centers[0]:lo=hi=0;w=0
                elif l>=centers[3]:lo=hi=3;w=0
                else:lo=j;hi=j+1;w=(l-centers[j])/max(1,centers[j+1]-centers[j])
                out=[]
                for k,v in [(1,aa),(2,bb)]:
                    p=parameters[lo];q=parameters[hi]
                    v1=(v-p['source_mean'][k])*p['gain'][k]+p['source_mean'][k]+p['shift'][k]
                    v2=(v-q['source_mean'][k])*q['gain'][k]+q['source_mean'][k]+q['shift'][k]
                    # Leave black depths and almost-white bevel glints restrained.
                    strength=min(1,(l-18)/22)*min(1,max(0,(b-min(r,g)-1)/10))
                    out.append(max(0,min(255,round(v+(v1*(1-w)+v2*w-v)*strength))))
                ld[idx]=(l,*out);mask[idx]=1;count+=1
            graded=lab.copy();graded.putdata(ld);rgb=ImageCms.applyTransform(graded,_TO_RGB)
            data=[(*q,p[3]) if mask[i] else p for i,(p,q) in enumerate(zip(orig,rgb.getdata()))]
            out=im.copy();out.putdata(data);out=clean(out);updated[n]=out;SPRITES[n]=out
            check=ImageCms.applyTransform(out.convert('RGB'),_TO_LAB)
            for idx,(old,new) in enumerate(zip(lab.getdata(),check.getdata())):
                if mask[idx] and idx%7==0:delta.append(abs(new[0]-old[0])*100/255);after[luminance_bucket(new[0])].append(new)
        SHEETS[sheet]=[(n,updated.get(n,im),info) for n,im,info in frames]
        model['sheets'][sheet]={'source':src,'after':lab_stats(after),'parameters':parameters,'pixels_matched':count,'mean_delta_L':statistics.mean(delta) if delta else 0,'max_delta_L':max(delta) if delta else 0}
    (ART/'v3/colour-model.json').write_text(json.dumps(model,indent=2)+'\n')
    provenance=json.loads((OUT/'prompts.json').read_text());provenance['v3_colour_transfer']=model;(OUT/'prompts.json').write_text(json.dumps(provenance,indent=2)+'\n')

def build():
    OUT.mkdir(parents=True,exist_ok=True)
    sync_provenance_v5(OUT)
    if not (OUT/'prompts.json').exists():shutil.copy2(LIVE/'prompts.json',OUT/'prompts.json')
    build_v2()
    rooms=source('v3-rooms');dressing=source('v3-dressing')
    for n,im in zip(['room-arch','room-cave','room-magic','room-forge'],rooms):add('stone',n,fit(im,(390,600),True),'feet')
    add('stone','pillar-capital',fit(dressing[0],(162,108),True),'tl')
    add('stone','window-arch',fit(dressing[1],(195,270),True),'feet')
    add('props','chain-pair',fit(dressing[2],(180,300),True),'top')
    colour_match()
    build_robots_v4()
    fix_art_v5()
    build_gold_props_v6()

def pack():
    OUT.mkdir(parents=True,exist_ok=True)
    if not (OUT/'prompts.json').exists():shutil.copy2(LIVE/'prompts.json',OUT/'prompts.json')
    for sheet,frames in SHEETS.items():
        width=1024;x=y=4;rowh=0;places=[]
        for name,im,info in frames:
            if im.width+8>width:raise ValueError(name+' too wide')
            if x+im.width+4>width:x=4;y+=rowh+4;rowh=0
            places.append((name,im,info,x,y));x+=im.width+4;rowh=max(rowh,im.height)
        atlas=Image.new('RGBA',(width,y+rowh+4));mapping={}
        for name,im,info,x,y in places:
            atlas.alpha_composite(im,(x,y));mapping[name]={'x':x,'y':y,'w':im.width,'h':im.height,**{k:v for k,v in info.items() if v is not None}}
        atlas=clean(atlas);atlas.save(OUT/(sheet+'.png'),optimize=True,compress_level=9)
        (OUT/(sheet+'.json')).write_text(json.dumps({'image':sheet+'.png','scale':3,'frames':mapping},indent=2)+'\n')

def contact():
    try:font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',13)
    except OSError:font=ImageFont.load_default()
    items=list(SPRITES.items());cw,ch=230,230;cols=7;rows=math.ceil(len(items)/cols)
    image=Image.new('RGB',(cols*cw,rows*ch),'#211d31');d=ImageDraw.Draw(image)
    for i,(n,im) in enumerate(items):
        x=i%cols*cw;y=i//cols*ch;thumb=fit(im,(208,184));image.paste(thumb,(x+(cw-thumb.width)//2,y+8+(184-thumb.height)//2),thumb)
        d.text((x+6,y+200),n,font=font,fill='#eadab9')
    image.save(ART/'contact-sheet.png',optimize=True)

def paste(can,name,x,y,width=None,height=None):
    im=SPRITES[name]
    if width is not None or height is not None:
        if width is None:width=im.width*height/im.height
        if height is None:height=im.height*width/im.width
        dest=(round(width),round(height));s=META[name].get('slice')
        if s:
            out=Image.new('RGBA',dest);xx=[0,s['left'],im.width-s['right'],im.width];yy=[0,s['top'],im.height-s['bottom'],im.height]
            dx=[0,s['left'],dest[0]-s['right'],dest[0]];dy=[0,s['top'],dest[1]-s['bottom'],dest[1]]
            for iy in range(3):
                for ix in range(3):
                    patch=im.crop((xx[ix],yy[iy],xx[ix+1],yy[iy+1]));size=(dx[ix+1]-dx[ix],dy[iy+1]-dy[iy])
                    if min(size)>0:out.alpha_composite(patch.resize(size,RESAMPLE),(dx[ix],dy[iy]))
            im=out
        else:im=im.resize(dest,RESAMPLE)
    can.alpha_composite(im,(round(x),round(y)))

def repeat(can,name,box):
    x,y,w,h=map(round,box);im=SPRITES[name];tmp=Image.new('RGBA',(w,h))
    for dy in range(0,h,im.height):
        for dx in range(0,w,im.width):tmp.alpha_composite(im,(dx,dy))
    can.alpha_composite(tmp,(x,y))

def mock():
    # All coordinates below are the reference's native concept pixels.
    # Every raster is rendered at 3x; only sprite pixels compose the scene.
    board=Image.new('RGBA',(3597,1095),'#201b2e')
    def p(n,x,y,w=None,h=None):paste(board,n,x*3,(y-100)*3,None if w is None else w*3,None if h is None else h*3)
    def r(n,x,y,w,h):repeat(board,n,(x*3,(y-100)*3,w*3,h*3))
    def pier(x,y,w,h):
        im=SPRITES['pillar'];im=im.resize((round(w*3),round(im.height*w*3/im.width)),RESAMPLE);tmp=Image.new('RGBA',(round(w*3),round(h*3)))
        for yy in range(0,tmp.height,im.height):tmp.alpha_composite(im,(0,yy))
        board.alpha_composite(tmp,(round(x*3),round((y-100)*3)))
    r('wall-brick-dark',0,100,1199,365)
    r('wall-brick',22,105,1150,322)
    r('terrace-floor',20,378,1160,74)
    p('room-arch',17,219,130,200);p('room-forge',1053,219,130,200)
    p('window-arch',894,103,55,78);p('chain-pair',263,154,38,70)
    # The outer enclosure, with lit top planes, thick piers and short returns.
    r('rampart-x',55,125,156,24);r('rampart-x',233,127,230,24);r('rampart-x',748,126,204,24);r('rampart-x',972,126,175,24)
    p('rampart-return-left',0,125,72,70);p('rampart-return-right',1130,125,69,70)
    for x,w in [(-5,44),(200,29),(970,29),(1161,44)]:
        pier(x,145,w,274);p('pillar-cap',x-4,123,w+8,27);p('pillar-base',x-4,404,w+8,29)
    # Recesses behind the project plaques: raised low walls form terraces.
    r('wall-brick-dark',166,250,267,83);r('wall-brick-dark',776,250,264,83)
    r('rampart-x',182,239,250,25);p('rampart-return-left',146,239,50,75)
    r('rampart-x',780,239,245,25);p('rampart-return-right',1014,239,50,75)
    # The upper host arch is a single dedicated surround, not a separate coin.
    p('gate-surround',433,95,333,231)
    p('icon-layers',577,125,47,47)
    p('plaque',462,177,275,65)
    # Side dressing at the exact LOCAL-floor positions.
    p('banner-navy-hammers',99,147,60,96);p('banner-purple-layers',310,129,59,95)
    p('banner-purple-layers',830,129,59,95);p('banner-blue-anvil',1036,148,59,96)
    p('bookcase-ladder',37,278,90,133);p('crate',63,245,42,43);p('crate',111,280,35,34);p('barrel',126,273,29,40)
    p('forge-0',1083,280,69,91);p('anvil',1077,368,58,36)
    p('crate',1098,250,25,29);p('barrel',1131,244,25,35);p('shelf-potions',964,324,50,49);p('table',965,363,75,43)
    for x,y,w,h in [(239,157,24,60),(406,204,23,65),(768,202,23,65),(939,153,24,65),(1137,325,24,77),(45,319,24,80)]:
        p('glow-running',x-22,y+2,w+44,h+12);p('torch-0',x,y,w,h)
    # Project medallions and parchment: normal label art stretched with 9-slice.
    for x,icon in [(282,'code'),(860,'cube')]:p('medallion',x,216,58,58);p('icon-'+icon,x+14,230,30,30)
    p('label',216,269,195,38);p('label',791,269,195,38)
    # The portcullis is behind its lower arch, gold lighting the first steps.
    p('gate-portcullis-lit-0',557,276,85,83);p('gate-arch',526,258,145,121)
    p('stairs-top',540,335,120,36);r('stairs-mid',540,371,120,64);p('stairs-bottom',540,428,120,29)
    # Alcove builder: individual dark slots, large piers, upper low-wall returns,
    # tall candles, a front step and the robots registered on that step.
    def room(x,y,w,label_x,label_w,slot_types,robot_positions):
        inner=w-40;num=len(slot_types);slotw=inner/num
        for i,t in enumerate(slot_types):p('alcove-slot-'+str(t),x+20+i*slotw,y+12,slotw,91)
        p('alcove-left',x,y+7,24,104);p('alcove-right',x+w-24,y+7,24,104)
        r('alcove-top',x+20,y,inner,22)
        p('rampart-return-left',x-2,y-5,45,43);p('rampart-return-right',x+w-43,y-5,45,43)
        p('label',label_x,y+17,label_w,35)
        r('alcove-ledge',x+20,y+98,inner,15)
        p('glow-running',x+15,y+62,inner+10,49)
        p('candle-0',x+25,y+53,10,46);p('candle-1',x+w-36,y+53,10,46)
        for xx,color in robot_positions:p('robot-'+color+'-idle-0',xx-18,y+58,36,42)
    room(134,313,224,185,132,[0,0,1],[(211,'blue'),(252,'purple'),(295,'green')])
    room(375,313,146,385,120,[0,1],[(421,'blue'),(466,'yellow')])
    room(675,313,285,768,151,[0,1,0,1,0],[(846,'blue')])
    # Torches and vignettes between rooms sit on the same foreground paving.
    p('crate',704,382,26,31);p('candle-0',969,337,10,42);p('candle-2',990,340,10,40)
    p('torch-0',699,345,17,63);p('torch-2',960,345,19,61)
    # Front edge forms a continuous heavy block wall with returns at either end.
    r('rampart-x',113,434,422,28);r('rampart-x',662,434,426,28)
    p('rampart-return-right',30,418,92,43);p('rampart-return-left',1081,418,88,43)
    p('rampart-end-left',12,410,31,30);p('rampart-end-right',1161,408,31,30)
    # The next host's upper arch just enters the bottom edge in the reference.
    p('gate-surround',433,434,333,231)
    board.convert('RGB').save(ART/'v3/local-floor.png',optimize=True)
    ref=Image.open('design/references/dungeon-concept.png').convert('RGB').crop((0,100,1199,465)).resize((3597,1095),RESAMPLE)
    compare=Image.new('RGB',(7254,1155),'#181425');d=ImageDraw.Draw(compare)
    d.text((15,15),'GENERATED V3 / only sprites / 3x',fill='white');d.text((3657,15),'PRIVATE REFERENCE / same crop / 3x',fill='white')
    compare.paste(board,(0,60),board);compare.paste(ref,(3657,60));compare.save(ART/'mock.png',optimize=True)
    # Matching close crop of the left-hand LOCAL terrace.
    l=board.crop((0,0,1800,1050)).convert('RGB');rr=ref.crop((0,0,1800,1050));cal=Image.new('RGB',(3660,1110),'#181425')
    cal.paste(l,(0,60));cal.paste(rr,(1860,60));ImageDraw.Draw(cal).text((15,15),'V3 calibration / LOCAL left / matched 3x crops',fill='white');cal.save(ART/'calibration.png',optimize=True)


def v3_reviews():
    old=ART/'v2/assets';ref=Image.open('design/references/dungeon-concept.png').convert('RGBA')
    proof=Image.new('RGBA',(1600,1220),'#211b32');d=ImageDraw.Draw(proof)
    for x,label in [(20,'V2'),(550,'V3 / Lab a-b match, L held'),(1080,'PRIVATE CONCEPT / 3x crop')]:d.text((x,15),label,fill='white')
    for sheet,n,y,box in [('gate','gate-arch',60,(526,258,671,379)),('stone','rampart-x',480,(178,244,244,266)),('alcoves','alcove-left',600,(134,328,158,422)),('stone','wall-brick',930,(269,160,309,216))]:
        j=json.loads((old/(sheet+'.json')).read_text());f=j['frames'][n];im=Image.open(old/(sheet+'.png')).crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
        proof.alpha_composite(im,(20,y));proof.alpha_composite(SPRITES[n],(550,y));r=ref.crop(box);proof.alpha_composite(r.resize((r.width*3,r.height*3),RESAMPLE),(1080,y));d.text((20,y-18),n,fill='#eadfc6')
    proof.convert('RGB').save(ART/'v3/tone-comparison.png',optimize=True)
    rooms=Image.new('RGBA',(2450,820),'#211b32');d=ImageDraw.Draw(rooms)
    for x,n in [(20,'room-arch'),(500,'room-cave'),(980,'room-magic'),(1460,'room-forge')]:
        paste(rooms,n,x,80);d.text((x,40),n+' / 130x200 concept px at 3x',fill='white')
    paste(rooms,'bookcase-ladder',100,330);paste(rooms,'crystal-0',620,500)
    paste(rooms,'magic-circle-0',1080,245);paste(rooms,'armor',1210,470);paste(rooms,'forge-0',1558,455)
    paste(rooms,'pillar-capital',1990,90);paste(rooms,'window-arch',1990,260);paste(rooms,'chain-pair',2250,200)
    d.text((1990,40),'Upper wall dressing',fill='white');rooms.convert('RGB').save(ART/'v3/rooms-mock.png',optimize=True)

def validate():
    ART.mkdir(parents=True,exist_ok=True)
    errors=[];details={};frames={};pixels={}
    for path in sorted(OUT.glob('*.json')):
        if path.name=='prompts.json':continue
        j=json.loads(path.read_text());im=Image.open(OUT/j['image']).convert('RGBA');alpha=im.getchannel('A')
        assert j['scale']==3
        for r,g,b,a in im.getdata():
            if (a==0 and (r or g or b)) or (0<a<12):
                errors.append(path.stem+' alpha cleanliness');break
        rects=[]
        for name,f in j['frames'].items():
            frames[name]=f;box=(f['x'],f['y'],f['x']+f['w'],f['y']+f['h']);rects.append((name,box))
            if not (0<=box[0]<box[2]<=im.width and 0<=box[1]<box[3]<=im.height):errors.append(name+' bounds')
            crop=im.crop(box);pixels[name]=crop;a=crop.getchannel('A')
            if not a.getbbox():errors.append(name+' empty')
            if ImageChops.difference(a,prune_micro(crop).getchannel('A')).getbbox():errors.append(name+' tiny alpha island')
            if name.startswith('robot-'):
                b=a.getbbox()
                if b and ((b[2]-b[0])/crop.width<.8 or (b[3]-b[1])/crop.height<.8):errors.append(name+' excess padding')
            # The full 2px external gutter must be transparent, even for tiles.
            for b in [(box[0]-2,box[1]-2,box[2]+2,box[1]),(box[0]-2,box[3],box[2]+2,box[3]+2),(box[0]-2,box[1],box[0],box[3]),(box[2],box[1],box[2]+2,box[3])]:
                if alpha.crop(b).getbbox():errors.append(name+' gutter')
            tile=f.get('tile','')
            for axis in tile:
                one=crop.crop((0,0,1,crop.height)) if axis=='x' else crop.crop((0,0,crop.width,1))
                two=crop.crop((crop.width-1,0,crop.width,crop.height)) if axis=='x' else crop.crop((0,crop.height-1,crop.width,crop.height))
                if any(high for low,high in ImageChops.difference(one,two).getextrema()):errors.append(name+' seam '+axis)
            if tile:
                proof=Image.new('RGBA',(crop.width*3,crop.height*3),'#171324')
                for y in range(3):
                    for x in range(3):proof.alpha_composite(crop,(x*crop.width,y*crop.height))
                proof.save(ART/('tile-'+name+'.png'))
        if path.stem=='stone':
            for n in ['wall-brick','wall-brick-dark']:
                f=j['frames'][n];crop=im.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']));proof=Image.new('RGBA',(crop.width*6,crop.height*4))
                for y in range(4):
                    for x in range(6):proof.alpha_composite(crop,(x*crop.width,y*crop.height))
                proof.save(ART/('tile-'+n+'-6x4.png'))
        details[path.stem]={'frames':len(j['frames']),'dimensions':list(im.size),'png_bytes':(OUT/j['image']).stat().st_size}
    # Contract checked independently of atlas assembly order.
    expected=[]
    for c in ['orange','white','blue','purple','green','yellow','red','grey','teal','pink']:
        expected += [f'robot-{c}-idle-{i}' for i in range(2)]+[f'robot-{c}-work-{i}' for i in range(4)]+[f'drone-{c}-{i}' for i in range(2)]
    expected += ['alcove-left','alcove-right','alcove-top']+[f'alcove-slot-{i}' for i in range(4)]+[f'candle-{i}' for i in range(3)]
    expected += ['gate-arch','gate-portcullis-dark','gate-medallion','stairs-top','stairs-mid','stairs-bottom','banner-crown']+[f'gate-portcullis-lit-{i}' for i in range(4)]
    expected += ['wall-brick','wall-brick-dark','floor-flag','ledge-face','ledge-end-left','ledge-end-right','pillar','pillar-cap','pillar-base','niche-arch','window-barred','border','border-corner']
    expected += ['label','plaque','medallion','node','panel','count-hosts','count-projects','count-workspaces','count-agents','dot-online','dot-offline','dot-warning']+['icon-'+x for x in ['layers','code','cube','chart','flask','person','gear','globe','book','terminal','database','rocket','shield','bolt','leaf','castle']]
    expected += [f'{n}-{i}' for n in ['torch','brazier','forge','crystal','alchemy-tank','magic-circle'] for i in range(4)]
    expected += ['banner-purple-layers','banner-purple','banner-navy-hammers','banner-blue-anvil','barrel','barrels','crate','crates','shelf-potions','bookcase-ladder','anvil','armor','scroll-desk','table','rug-red','chain','portcullis-side','cobweb']
    expected += ['mark-'+x for x in ['approval','question','failure','done','running']]+['glow-'+x for x in ['running','idle','done','approval','question','failure','offline']]
    expected += ['pr-'+x for x in ['ci-running','ci-green','ci-failing','review-awaiting','review-approved','review-changes','conflicts']]+['probe-'+x for x in ['reviewing','approved','findings','stale','failed']]+['seal-automerge']
    expected += ['rampart-x','rampart-y','rampart-corner-tl','rampart-corner-tr','rampart-corner-bl','rampart-corner-br','rampart-end-left','rampart-end-right','rampart-end-top','rampart-end-bottom','rampart-t-down','terrace-floor','alcove-ledge','gate-surround','torch-out','mark-asking','glow-asking']
    expected += ['room-arch','room-cave','room-magic','room-forge','pillar-capital','window-arch','chain-pair']
    expected += [f'{b}-{i}' for b in ['candelabra','wall-candles'] for i in range(4)]+['candelabra-out','wall-candles-out']
    missing=sorted(set(expected)-set(frames));extra=sorted(set(frames)-set(expected))
    if missing:errors.append('Missing '+str(missing))
    groups={}
    for n,f in frames.items():
        if re.search(r'-\d+$',n):groups.setdefault(re.sub(r'-\d+$','',n),[]).append(f)
    for n,fs in groups.items():
        # Slot interiors are variants rather than an animation.
        if n=='alcove-slot':continue
        if len({(f['w'],f['h'],f['anchor']['x'],f['anchor']['y']) for f in fs})!=1:errors.append(n+' registration')
    if any(frames['torch-out'][k]!=frames['torch-0'][k] for k in ['w','h','anchor']):errors.append('torch-out registration')
    for prefix,count,stable_y in [('torch',4,83),('brazier',4,103),('candle',3,47),('forge',4,216)]:
        imgs=[pixels[f'{prefix}-{i}'] for i in range(count)]
        if len({im.tobytes() for im in imgs})!=count:errors.append(prefix+' duplicate flame frames')
        for im in imgs[1:]:
            a=imgs[0].crop((0,stable_y,im.width,im.height));b=im.crop((0,stable_y,im.width,im.height))
            if any(hi for lo,hi in ImageChops.difference(a,b).getextrema()):errors.append(prefix+' holder moved')
    dark=pixels['wall-brick-dark'].convert('L');wall=pixels['wall-brick'].convert('L')
    if sum(dark.getdata())/(dark.width*dark.height)>sum(wall.getdata())/(wall.width*wall.height)*.7:errors.append('wall-brick-dark too bright')
    total=sum(p.stat().st_size for p in OUT.iterdir() if p.is_file())
    if total>12*1024*1024:errors.append('over 12MiB')
    report={'scale':3,'sheets':details,'frame_count':len(frames),'contract_count':len(expected),'missing':missing,'extra':extra,'animation_groups_checked':len(groups)-1,'total_asset_bytes':total,'errors':errors,'note':'Source alpha <12 removed; alpha >=240 normalized to opaque; zero-alpha RGB cleared. Pixel seams compare all RGBA channels exactly. See tile-*.png for 3x3 visual repeat proofs.'}
    (ART/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    if errors:raise SystemExit(1)

def publish():
    # Every PNG and JSON is already complete and validated in staging. Each
    # live file changes by atomic rename; no renderer sees a partial write.
    if not (OUT/'prompts.json').exists():raise ValueError('Staged provenance is missing')
    for name in ['robots','alcoves','gate','stone','ui','props','status']:
        for suffix in ['.png','.json']:
            dest=LIVE/(name+suffix);temp=LIVE/(name+suffix+'.v3-ready')
            if dest.exists() and dest.read_bytes()==(OUT/(name+suffix)).read_bytes():continue
            shutil.copy2(OUT/(name+suffix),temp);os.replace(temp,dest)
    temp=LIVE/'prompts.json.v3-ready';shutil.copy2(OUT/'prompts.json',temp);os.replace(temp,LIVE/'prompts.json')
    script=Path(__file__);dest=Path('rendering/scripts/dungeon-art.py');dest.parent.mkdir(parents=True,exist_ok=True)
    if script.resolve()!=dest.resolve():
        temp=dest.with_suffix('.py.v3-ready');shutil.copy2(script,temp);os.replace(temp,dest)
    (LIVE/'build.py').unlink(missing_ok=True)

def visor_mask(im):
    """Protect the connected dark visor and its enclosed white eyes/bloom."""
    w,h=im.size;px=list(im.getdata());mask=bytearray(w*h)
    for y in range(h):
        for x in range(w):
            r,g,b,a=px[y*w+x]
            if .08*w<x<.92*w and .16*h<y<.75*h and a>100 and max(r,g,b)<95 and g>=r*.90:mask[y*w+x]=1
    best=[]
    for root in range(w*h):
        if mask[root]!=1:continue
        todo=[root];mask[root]=2;c=[]
        while todo:
            k=todo.pop();c.append(k);x=k%w;y=k//w
            for xx,yy in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if 0<=xx<w and 0<=yy<h:
                    q=yy*w+xx
                    if mask[q]==1:mask[q]=2;todo.append(q)
        if len(c)>len(best):best=c
    rows={}
    for k in best:
        x=k%w;y=k//w
        if y not in rows:rows[y]=[x,x]
        else:rows[y]=[min(rows[y][0],x),max(rows[y][1],x)]
    out=bytearray(w*h)
    for y,(a,b) in rows.items():
        for x in range(max(0,a-1),min(w,b+2)):out[y*w+x]=1
    return out

def tint_v4(im,name):
    targets={'orange':(255,124,16),'white':(250,252,255),'blue':(0,178,255),'purple':(174,58,255),'green':(56,229,32),'yellow':(255,215,12),'red':(255,55,52),'grey':(120,134,149),'teal':(0,226,197),'pink':(255,86,184)}
    protected=visor_mask(im);result=[]
    for idx,(r,g,b,a) in enumerate(im.getdata()):
        if not a:result.append((0,0,0,0));continue
        # Leave dark outlines, cyan lamps/thrusters, eye whites/bloom, and warm
        # bounce intact. Only the neutral ceramic shell is recoloured.
        shell=not protected[idx] and min(r,g,b)>62 and max(r,g,b)>94 and b>=g*.82 and r>=g*.82
        if not shell:result.append((r,g,b,a));continue
        lum=(r*.25+g*.55+b*.20)/255
        highlight=max(0,min(1,(lum-.88)/.12))**1.3*.92
        shade=min(1.16,.44+.88*lum)
        if name=='white':
            # White remains white, distinct from the medium steel-grey shell.
            neutral=min(255,round(255*(.15+.85*lum)))
            result.append((neutral,min(255,neutral+1),min(255,neutral+4),a))
        else:
            t=targets[name];result.append(tuple(min(255,round(v*shade*(1-highlight)+255*highlight)) for v in t)+(a,))
    out=im.copy();out.putdata(result);return out

def build_robots_v4():
    raw=Image.open(ART/'v4/robots-raw.png').convert('RGBA');parts=[]
    for y in range(2):
        for x in range(4):
            im=trim(raw.crop((round(x*raw.width/4),round(y*raw.height/2),round((x+1)*raw.width/4),round((y+1)*raw.height/2))))
            # Tight alpha bounds after cleaning; no extra visible-body margins.
            im=prune_micro(clean(im,24));im=im.crop(im.getchannel('A').getbbox());parts.append(im)
    SHEETS['robots']=[]
    for n in list(SPRITES):
        if n.startswith('robot-') or n.startswith('drone-'):del SPRITES[n];META.pop(n,None)
    # Consistent scale with visible work bob; all robot feet share one baseline.
    heights=[175,172,154,175,158,175,42,42]
    for color in ['orange','white','blue','purple','green','yellow','red','grey','teal','pink']:
        for idx,src in enumerate(parts):
            drone=idx>=6
            body=fit(src,(63 if drone else 150,heights[idx]),True);body=tint_v4(body,color)
            canvas=Image.new('RGBA',(73,52) if drone else (172,185));baseline=48 if drone else 179
            dx=(canvas.width-body.width)//2
            if not drone:
                b=body.getchannel('A').getbbox();foot=body.getchannel('A').crop((0,b[3]-20,body.width,b[3])).getbbox()
                dx=round(canvas.width/2-(foot[0]+foot[2])/2)
                if dx<0 or dx+body.width>canvas.width:raise ValueError('Robot registration would clip '+str(idx))
            canvas.alpha_composite(body,(dx,baseline-body.height))
            name=f'robot-{color}-idle-{idx}' if idx<2 else f'robot-{color}-work-{idx-2}' if idx<6 else f'drone-{color}-{idx-6}'
            # Relative sheet-pixel anchor at ground contact / thruster base.
            anchor=(canvas.width/2+2,baseline+2)
            add('robots',name,canvas,anchor,**({'fps':2 if idx==0 else 6 if idx==2 else 4} if idx in [0,2,6] else {}))

def load_live_art():
    for path in sorted(LIVE.glob('*.json')):
        if path.stem=='prompts':continue
        j=json.loads(path.read_text());atlas=Image.open(LIVE/j['image']).convert('RGBA')
        for n,f in j['frames'].items():
            SPRITES[n]=atlas.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']));META[n]={k:v for k,v in f.items() if k not in ['x','y','w','h']}

def robot_v4_comparison():
    oldj=json.loads((ART/'v3/robots.json').read_text());oldpng=Image.open(ART/'v3/robots.png').convert('RGBA')
    stonej=json.loads((LIVE/'stone.json').read_text());stonepng=Image.open(LIVE/'stone.png').convert('RGBA')
    f=stonej['frames']['terrace-floor'];tile=stonepng.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
    review=Image.new('RGBA',(2040,1520),'#1c192a');d=ImageDraw.Draw(review)
    for y in [80,320,560,800,1040,1280]:
        for x in range(0,2040,tile.width):review.alpha_composite(tile,(x,y))
    colors=['orange','white','blue','purple','green','yellow','red','grey','teal','pink']
    def shown(im):
        im=im.crop(im.getchannel('A').getbbox());return im.resize((108,126),RESAMPLE)
    for i,c in enumerate(colors):
        col=i%2;row=i//2;x=col*1020;y=row*240+90
        n=f'robot-{c}-idle-0';f=oldj['frames'][n];a=oldpng.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
        review.alpha_composite(shown(a),(x+170,y+35));review.alpha_composite(shown(SPRITES[n]),(x+570,y+35))
        d.text((x+30,y-25),c+' / same displayed body size',fill='white');d.text((x+180,y+170),'V3',fill='white');d.text((x+580,y+170),'V4',fill='white')
    d.text((20,20),'ROBOTS V4 / V3 and V4 at identical displayed alpha bounds / dungeon stone',fill='white')
    for x,c in [(0,'blue'),(1020,'purple')]:
        n=f'drone-{c}-0';f=oldj['frames'][n];a=oldpng.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']));a=a.crop(a.getchannel('A').getbbox()).resize((45,30),RESAMPLE)
        b=SPRITES[n];b=b.crop(b.getchannel('A').getbbox()).resize((45,30),RESAMPLE)
        review.alpha_composite(a,(x+200,1360));review.alpha_composite(b,(x+600,1360));d.text((x+30,1295),c+' drone / same displayed body size',fill='white');d.text((x+200,1430),'V3',fill='white');d.text((x+600,1430),'V4',fill='white')
    review.convert('RGB').save(ART/'robots-v4.png',optimize=True)
    # Motion proof keeps the fixed feet anchor, rather than fitting each pose.
    gif=[]
    for idx in range(4):
        can=Image.new('RGBA',(540,270),'#211c33')
        for x in range(0,540,tile.width):can.alpha_composite(tile,(x,75))
        im=SPRITES[f'robot-blue-work-{idx}'];can.alpha_composite(im,(175,45));gif.append(can.convert('RGB'))
    gif[0].save(ART/'v4/work-animation.gif',save_all=True,append_images=gif[1:],duration=165,loop=0)
    poses=Image.new('RGBA',(800,275),'#211c33');d=ImageDraw.Draw(poses)
    for i in range(4):poses.alpha_composite(SPRITES[f'robot-blue-work-{i}'],(i*195+5,35));d.text((i*195+15,235),f'work-{i}',fill='white')
    poses.convert('RGB').save(ART/'v4/work-poses.png')

def validate_robots_v4():
    j=json.loads((OUT/'robots.json').read_text());im=Image.open(OUT/'robots.png').convert('RGBA');frames=j['frames'];old=json.loads((ART/'v3/robots.json').read_text())['frames'];errors=[]
    if set(frames)!=set(old):errors.append('Frame names changed')
    if j['scale']!=3:errors.append('Scale changed')
    boxes={}
    for n,f in frames.items():
        box=(f['x'],f['y'],f['x']+f['w'],f['y']+f['h']);v=im.crop(box);b=v.getchannel('A').getbbox();boxes[n]=b
        if not b:errors.append(n+' empty');continue
        if abs(f['anchor']['x']-f['w']/2)>.01 or abs(f['anchor']['y']-b[3])>3:errors.append(n+' feet anchor')
        if n.startswith('robot-'):
            foot=v.getchannel('A').crop((0,b[3]-20,v.width,b[3])).getbbox()
            if abs((foot[0]+foot[2])/2-f['anchor']['x'])>1:errors.append(n+' feet centre moved')
    for c in ['orange','white','blue','purple','green','yellow','red','grey','teal','pink']:
        heights=[boxes[f'robot-{c}-work-{i}'][3]-boxes[f'robot-{c}-work-{i}'][1] for i in range(4)]
        if max(heights)-min(heights)<15:errors.append(c+' weak work bob')
    report={'frames':len(frames),'scale':j['scale'],'same_names_as_v3':set(frames)==set(old),'idle_visible_bounds':{c:[boxes[f'robot-{c}-idle-0'][2]-boxes[f'robot-{c}-idle-0'][0],boxes[f'robot-{c}-idle-0'][3]-boxes[f'robot-{c}-idle-0'][1]] for c in ['white','blue','grey']},'work_bob_pixels':max(heights)-min(heights),'errors':errors}
    (ART/'v4/robot-validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    if errors:raise SystemExit(1)

def robots_only(publish_live=False):
    global OUT
    OUT=ART/'v4/staging';OUT.mkdir(parents=True,exist_ok=True)
    sync_provenance_v5(OUT)
    for p in LIVE.iterdir():
        if p.suffix in ['.png','.json'] and not (p.name=='prompts.json' and (OUT/p.name).exists()):shutil.copy2(p,OUT/p.name)
    load_live_art();build_robots_v4();pack();validate();validate_robots_v4();contact();robot_v4_comparison()
    if publish_live:
        for n in ['robots.png','robots.json','prompts.json']:
            tmp=LIVE/(n+'.v4-ready');shutil.copy2(OUT/n,tmp);os.replace(tmp,LIVE/n)
        src=Path(__file__);dest=Path('rendering/scripts/dungeon-art.py')
        if src.resolve()!=dest.resolve():
            tmp=dest.with_suffix('.py.v4-ready');shutil.copy2(src,tmp);os.replace(tmp,dest)


def source_v5(key,cols,rows):
    im=Image.open(ART/'v5'/(key+'-raw.png')).convert('RGBA');out=[]
    for y in range(rows):
        for x in range(cols):out.append(trim(im.crop((round(x*im.width/cols),round(y*im.height/rows),round((x+1)*im.width/cols),round((y+1)*im.height/rows)))))
    return out

def framed_v5(im,size):
    im=prune_micro(fit(im,(size[0]-4,size[1]-4),True));out=Image.new('RGBA',size);out.alpha_composite(im,(2,2));return clean(out)

def pale_parchment_v5(im):
    lab=ImageCms.applyTransform(im.convert('RGB'),_TO_LAB);rgb=list(im.getdata());ld=list(lab.getdata())
    sample=[];mask=bytearray(len(rgb))
    for k,(p,q) in enumerate(zip(rgb,ld)):
        x=k%im.width;y=k//im.width;r,g,b,a=p;l,aa,bb=q
        if a>220 and 24<x<im.width-24 and 17<y<im.height-17 and l>174 and 132<bb<172 and aa<145 and r>g>b and r-g<45:
            sample.append(q);mask[k]=1
    mean=[statistics.median(p[k] for p in sample) for k in range(3)];target=[91*255/100,132,155]
    lab.putdata([tuple(max(0,min(255,round(v+target[c]-mean[c]))) for c,v in enumerate(q)) if mask[k] else q for k,q in enumerate(ld)])
    converted=ImageCms.applyTransform(lab,_TO_RGB);data=[(*q,p[3]) if mask[k] else p for k,(p,q) in enumerate(zip(rgb,converted.getdata()))];out=im.copy();out.putdata(data);return clean(out)

def warm_material_v5(im,sheet,name):
    if sheet in ['robots','status']:return im
    floor=name in ['floor-flag','terrace-floor','alcove-ledge']
    if sheet=='stone':
        if name=='wall-brick-dark':dl,db,da=.65,1.8,0
        elif name=='wall-brick':dl,db,da=4,6,1
        elif floor:dl,db,da=5.5,27,1.8
        else:dl,db,da=3,8.5,1
    elif sheet=='alcoves' and not name.startswith('candle-'):dl,db,da=(5.5,24,1.5) if floor else (3,9,1)
    elif sheet=='gate' and (name in ['gate-arch','gate-surround','gate-medallion','stairs-top','stairs-mid','stairs-bottom']):dl,db,da=2.7,9,1
    elif sheet=='ui' and name=='medallion':dl,db,da=2.5,7,1
    elif sheet=='props' and (name in ['anvil','armor'] or any(name.startswith(n+'-') for n in ['forge','brazier','crystal','alchemy-tank'])):dl,db,da=2.5,7,1
    else:return im
    rgb=list(im.getdata());lab=ImageCms.applyTransform(im.convert('RGB'),_TO_LAB);ld=list(lab.getdata());mask=bytearray(len(rgb))
    for k,((r,g,b,a),(l,aa,bb)) in enumerate(zip(rgb,ld)):
        L=l*100/255
        if not a or L<18 or L>94:continue
        cool=stone_pixel(r,g,b)
        gold=r>g>b and r>125 and g>85 and bb>148 and L>46
        if not cool and not gold:continue
        t=max(0,min(1,(L-20)/(35 if floor else 45)));t=t*t*(3-2*t)
        if name=='wall-brick':
            t=max(0,min(1,(L-12)/26));t=t*t*(3-2*t)
        if cool:
            extra=1
            if sheet=='alcoves' and name.startswith('alcove-slot-') and k//im.width>im.height*.77:extra=1.5
            ld[k]=(min(248,round(l+dl*2.55*t*extra)),max(0,min(255,round(aa+da*t))),max(0,min(255,round(bb+db*t*extra))))
        elif gold:
            # Strengthen existing reflected amber bevels, keeping them painted
            # into the material rather than adding another external halo.
            ld[k]=(min(248,round(l+2.6*2.55*t)),aa,min(255,round(bb+1.5*t)))
        mask[k]=1
    lab.putdata(ld);graded=ImageCms.applyTransform(lab,_TO_RGB);out=im.copy();out.putdata([(*q,p[3]) if mask[k] else p for k,(p,q) in enumerate(zip(rgb,graded.getdata()))]);return clean(out)

def old_v3_grade_v5(im,sheet):
    model=json.loads((LIVE/'prompts.json').read_text())['v3_colour_transfer']['sheets'][sheet];ps=model['parameters'];cs=[p['L'] for p in ps]
    rgb=list(im.getdata());lab=ImageCms.applyTransform(im.convert('RGB'),_TO_LAB);ld=list(lab.getdata());mask=bytearray(len(rgb))
    for idx,((r,g,b,a),(l,aa,bb)) in enumerate(zip(rgb,ld)):
        if not a or l<22 or not stone_pixel(r,g,b):continue
        j=0
        while j<2 and l>cs[j+1]:j+=1
        if l<=cs[0]:lo=hi=0;w=0
        elif l>=cs[3]:lo=hi=3;w=0
        else:lo=j;hi=j+1;w=(l-cs[j])/max(1,cs[j+1]-cs[j])
        out=[]
        for c,v in [(1,aa),(2,bb)]:
            p=ps[lo];q=ps[hi];u=(v-p['source_mean'][c])*p['gain'][c]+p['source_mean'][c]+p['shift'][c];v2=(v-q['source_mean'][c])*q['gain'][c]+q['source_mean'][c]+q['shift'][c];strength=min(1,(l-18)/22)*min(1,max(0,(b-min(r,g)-1)/10));out.append(max(0,min(255,round(v+(u*(1-w)+v2*w-v)*strength))))
        ld[idx]=(l,*out);mask[idx]=1
    lab.putdata(ld);graded=ImageCms.applyTransform(lab,_TO_RGB);out=im.copy();out.putdata([(*q,p[3]) if mask[k] else p for k,(p,q) in enumerate(zip(rgb,graded.getdata()))]);return clean(out)

def fire_repaints_v5():
    fire=source_v5('fire',4,2);pa=source('v2-propsA');fp=source('v2-flames');replacements={}
    maxh=max(p.height for p in fire[:4]);flames=[]
    for p in fire[:4]:
        h=round(p.height*72/maxh);w=round(p.width*72/maxh);im=fit(p,(w,h),True);can=Image.new('RGBA',(72,78));can.alpha_composite(im,((72-w)//2,76-h));flames.append(can)
    for prefix,body,size,bpos,fpos,fsize,count in [
        ('torch',fit(pa[0],(45,99),True),(60,153),(8,50),(0,0),(60,67),4),
        ('brazier',fit(pa[1],(105,111),True),(117,180),(6,65),(0,0),(117,88),4),
        ('candle',fit(fp[6],(30,93)),(40,125),(5,30),(3,0),(34,39),3)]:
        body_canvas=Image.new('RGBA',size);body_canvas.alpha_composite(body,bpos);alpha=Image.new('RGBA',(size[0]+4,size[1]+4));alpha.alpha_composite(body_canvas,(2,2))
        # Recover the already calibrated holder from the current sprite. Its
        # physical alpha removes the old flame above it; the bowl stays warm.
        base=SPRITES[prefix+'-0'].copy();base.putalpha(alpha.getchannel('A'));base=clean(base)
        for i in range(count):
            out=base.copy();out.alpha_composite(fit(flames[i],fsize,True),(fpos[0]+2,fpos[1]+2));replacements[f'{prefix}-{i}']=out
    body=stone_grade(fit(pa[10],(198,228),True));body=old_v3_grade_v5(body,'props')
    for i,p in enumerate(fire[4:]):
        # Broad coal bed behind the forge arch, clipped to the actual opening.
        layer=Image.new('RGBA',body.size);layer.alpha_composite(fit(p,(85,90),True),(59,116))
        mask=Image.new('L',body.size);d=ImageDraw.Draw(mask);d.polygon([(59,205),(59,149),(69,129),(85,116),(105,116),(124,130),(144,150),(144,205)],fill=255)
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mask));out=body.copy();out.alpha_composite(layer);frame=Image.new('RGBA',(202,232));frame.alpha_composite(out,(2,2));replacements[f'forge-{i}']=frame
    return replacements

def fix_art_v5():
    replacements=fire_repaints_v5();work=source_v5('workshop',2,1);ui=source_v5('ui',1,3)
    for i,n in enumerate(['alcove-slot-1','alcove-slot-2']):
        im=region(work[i],(.08,.12,.94,.97));im=framed_v5(im,SPRITES[n].size)
        if i==0:
            im.putdata([(round(r*.86),round(g*.86),round(b*.86),a) if g>r*1.4 and b>r*1.4 and b>160 else (r,g,b,a) for r,g,b,a in im.getdata()])
        replacements[n]=im
    for n,p in zip(['label','plaque','panel'],ui):
        im=framed_v5(p,SPRITES[n].size);replacements[n]=pale_parchment_v5(im) if n!='panel' else im
    metrics={}
    for sheet,frames in SHEETS.items():
        updated=[]
        for n,im,info in frames:
            original=im;im=replacements.get(n,im);im=prune_micro(warm_material_v5(im,sheet,n)) if not info.get('tile') else warm_material_v5(im,sheet,n)
            if im.size!=original.size:raise ValueError(n+' changed frame size')
            updated.append((n,im,info));SPRITES[n]=im
            if n in ['terrace-floor','floor-flag','rampart-x','wall-brick','label','plaque']:
                def meanlab(x):
                    l=ImageCms.applyTransform(x.convert('RGB'),_TO_LAB);pts=[q for p,q in zip(x.getdata(),l.getdata()) if p[3]>220]
                    return [statistics.mean(q[0] for q in pts)*100/255,statistics.mean(q[1] for q in pts)-128,statistics.mean(q[2] for q in pts)-128]
                metrics[n]={'before_Lab':meanlab(original),'after_Lab':meanlab(im)}
        SHEETS[sheet]=updated
    (ART/'v5/material-metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
    provenance=json.loads((OUT/'prompts.json').read_text());provenance['v5_material_pass']={'method':'Luminance-weighted warm CIELab highlight transfer; violet mortar/deep recesses and cyan magic protected; stronger warm grey floor profile; cream parchment target L*=91 a*=4 b*=27','metrics':metrics};(OUT/'prompts.json').write_text(json.dumps(provenance,indent=2)+'\n')

def load_live_sheets_v5():
    load_live_art()
    for path in sorted(LIVE.glob('*.json')):
        if path.stem=='prompts':continue
        j=json.loads(path.read_text())
        # Rebuild the v5 transfer from its pre-pass albedo, not an already
        # warmed live image. Keep current robot/status images untouched.
        if path.stem not in ['robots','status']:
            base=ART/'v5/before';bj=json.loads((base/path.name).read_text());atlas=Image.open(base/bj['image']).convert('RGBA')
            if bj!=j:raise ValueError(path.name+' geometry no longer matches v5 baseline')
            for n,f in bj['frames'].items():SPRITES[n]=atlas.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
        SHEETS[path.stem]=[(n,SPRITES[n],META[n]) for n in j['frames']]

def art_review_v5():
    old=ART/'v5/before';pairs=[('stone','terrace-floor'),('stone','wall-brick'),('stone','rampart-x'),('alcoves','alcove-slot-1'),('alcoves','alcove-slot-2'),('ui','plaque'),('ui','panel'),('props','torch-0'),('props','forge-0')]
    can=Image.new('RGBA',(1900,len(pairs)*275+55),'#231d30');d=ImageDraw.Draw(can);d.text((15,10),'ASSET FIXES / V4 baseline left / V5 art right / identical frame size',fill='white')
    for i,(sheet,n) in enumerate(pairs):
        y=i*275+65;j=json.loads((old/(sheet+'.json')).read_text());f=j['frames'][n];oldim=Image.open(old/(sheet+'.png')).crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']))
        for x,im in [(20,oldim),(970,SPRITES[n])]:
            im=fit(im,(900,235));can.alpha_composite(im,(x,y))
        d.text((20,y-20),n,fill='white')
    can.convert('RGB').save(ART/'v5/art-changes.png',optimize=True)

def art_only_v5(publish_live=False):
    global OUT
    OUT=ART/'v5/staging';OUT.mkdir(parents=True,exist_ok=True)
    sync_provenance_v5(OUT)
    for p in LIVE.iterdir():
        if p.suffix in ['.png','.json'] and not (p.name=='prompts.json' and (OUT/p.name).exists()):shutil.copy2(p,OUT/p.name)
    load_live_sheets_v5();fix_art_v5();pack()
    # Byte-preserve metadata: this pass repaints only existing rectangles.
    for p in LIVE.glob('*.json'):
        if p.stem=='prompts':continue
        a=json.loads(p.read_text());b=json.loads((OUT/p.name).read_text())
        if a!=b:raise ValueError(p.name+' changed metadata')
        shutil.copy2(p,OUT/p.name)
    validate();contact();art_review_v5()
    if (OUT/'robots.png').read_bytes()!=(LIVE/'robots.png').read_bytes():raise ValueError('Robot pixels changed')
    if publish_live:publish()

def sync_provenance_v5(out):
    """An older cached stage must not erase a later generation's provenance."""
    src=LIVE/'prompts.json';dest=out/'prompts.json'
    if not dest.exists() or json.loads(src.read_text()).get('version',0)>json.loads(dest.read_text()).get('version',0):shutil.copy2(src,dest)


def sources_v6():
    im=Image.open(ART/'v6/props-raw.png').convert('RGBA');parts=[]
    for y in range(2):
        for x in range(2):parts.append(trim(im.crop((round(x*im.width/2),round(y*im.height/2),round((x+1)*im.width/2),round((y+1)*im.height/2)))))
    return parts

def gold_trim_v6(im):
    rgb=list(im.getdata());hsv=im.convert('RGB').convert('HSV');lab=ImageCms.applyTransform(im.convert('RGB'),_TO_LAB);ld=list(lab.getdata());mask=bytearray(len(rgb))
    for k,((h,s,v),(l,a,b),p) in enumerate(zip(hsv.getdata(),ld,rgb)):
        if p[3]>0 and 18<=h*360/255<=65 and s>64 and v>75 and 68<l<239:
            ld[k]=(min(248,l+8),max(0,a-1),min(255,b+4));mask[k]=1
    lab.putdata(ld);out=im.copy();converted=ImageCms.applyTransform(lab,_TO_RGB);out.putdata([(*q,p[3]) if mask[k] else p for k,(p,q) in enumerate(zip(rgb,converted.getdata()))]);return clean(out)

def wax_tops_v6(im,n):
    """Locate the ivory candle caps, so new flames meet their actual wicks."""
    px=im.load();result=[]
    for i in range(n):
        candidates=[]
        for y in range(round(im.height*.60)):
            for x in range(round(i*im.width/n),round((i+1)*im.width/n)):
                r,g,b,a=px[x,y]
                if a>180 and r>190 and g>165 and b>105:candidates.append((x,y))
        top=min(y for x,y in candidates);cap=[x for x,y in candidates if y<=top+max(2,round(im.height*.025))]
        result.append(((min(cap)+max(cap))/2,top+1))
    return result

def build_gold_props_v6():
    parts=sources_v6();fires=source_v5('fire',4,2);maxh=max(f.height for f in fires[:4]);flames=[]
    for f in fires[:4]:
        w=round(f.width*72/maxh);h=round(f.height*72/maxh);fire=fit(f,(w,h),True);can=Image.new('RGBA',(72,78));can.alpha_composite(fire,((72-w)//2,76-h));flames.append(can)
    changed={}
    # Existing brazier: same frame extent and feet anchor, broader bowl and
    # full fire bed. Its front lip is redrawn over the coals, not under them.
    body=fit(parts[2],(105,111),True);base=Image.new('RGBA',(117,180));base.alpha_composite(body,(6,65))
    for i,f in enumerate(fires[4:]):
        can=base.copy();layer=Image.new('RGBA',base.size);layer.alpha_composite(fit(f,(117,88),True),(0,8));mouth=Image.new('L',base.size);md=ImageDraw.Draw(mouth);md.rectangle((0,0,116,76),fill=255);md.ellipse((12,70,105,108),fill=255);layer.putalpha(ImageChops.multiply(layer.getchannel('A'),mouth));can.alpha_composite(layer);lip=base.crop((0,94,117,122));can.alpha_composite(lip,(0,94));out=Image.new('RGBA',(121,184));out.alpha_composite(can,(2,2));changed[f'brazier-{i}']=clean(out)
    changed['rug-red']=framed_v5(parts[3],SPRITES['rug-red'].size)
    updated=[]
    for n,im,info in SHEETS['props']:
        out=changed.get(n,im)
        if n.startswith('banner-'):out=gold_trim_v6(out)
        out=prune_micro(out);updated.append((n,out,info));SPRITES[n]=out
    SHEETS['props']=updated
    # New optional flame-bearing clusters. Every old frame remains in place.
    for key,part,count,size,bpos,body_size,baseline,anchor in [
        ('candelabra',parts[0],3,(100,142),(5,26),(90,110),136,(52,138)),
        ('wall-candles',parts[1],2,(128,148),(10,28),(108,116),144,(66,2))]:
        body=fit(part,body_size,True);points=wax_tops_v6(body,count);base=Image.new('RGBA',size);base.alpha_composite(body,bpos)
        for i in range(4):
            can=base.copy()
            for j,(x,y) in enumerate(points):
                fire=fit(flames[(i+j)%4],(24,28),True);bx=round(bpos[0]+x);by=round(bpos[1]+y)
                can.alpha_composite(fire,(bx-12,by-27))
            add('props',f'{key}-{i}',can,anchor,**({'fps':7} if i==0 else {}))
        dark=base.copy();dark.putdata([(round(r*.72),round(g*.72),round(b*.75),a) for r,g,b,a in base.getdata()]);add('props',key+'-out',dark,anchor)

def load_baseline_props_v6():
    load_live_art();base=ART/'v6/before';j=json.loads((base/'props.json').read_text());im=Image.open(base/'props.png').convert('RGBA')
    SHEETS['props']=[]
    for n,f in j['frames'].items():
        crop=im.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']));info={k:v for k,v in f.items() if k not in ['x','y','w','h']};SPRITES[n]=crop;META[n]=info;SHEETS['props'].append((n,crop,info))

def props_review_v6():
    old=ART/'v6/before';j=json.loads((old/'props.json').read_text());atlas=Image.open(old/'props.png');pairs=['brazier-0','rug-red','banner-purple-layers','banner-navy-hammers']
    can=Image.new('RGBA',(1500,1400),'#221c31');d=ImageDraw.Draw(can);d.text((20,15),'V6 PROPS / previous left / revised right / identical displayed extent',fill='white')
    for i,n in enumerate(pairs):
        y=60+i*260;f=j['frames'][n];a=atlas.crop((f['x'],f['y'],f['x']+f['w'],f['y']+f['h']));can.alpha_composite(a,(25,y));can.alpha_composite(SPRITES[n],(620,y));d.text((25,y-20),n,fill='white')
    y=1130
    for i,n in enumerate(['candelabra-0','candelabra-out','wall-candles-0','wall-candles-out']):can.alpha_composite(SPRITES[n],(30+i*330,y));d.text((30+i*330,y-25),n,fill='white')
    can.convert('RGB').save(ART/'v6/props-review.png',optimize=True)

def validate_props_v6():
    j=json.loads((OUT/'props.json').read_text());old=json.loads((ART/'v6/before/props.json').read_text());errors=[]
    for n,f in old['frames'].items():
        if j['frames'].get(n)!=f:errors.append(n+' old metadata changed')
    for base in ['candelabra','wall-candles']:
        fs=[j['frames'][f'{base}-{i}'] for i in range(4)]+[j['frames'][base+'-out']]
        if len({(f['w'],f['h'],f['anchor']['x'],f['anchor']['y']) for f in fs})!=1:errors.append(base+' registration')
    if (OUT/'robots.png').read_bytes()!=(LIVE/'robots.png').read_bytes():errors.append('robots changed')
    (ART/'v6/props-validation.json').write_text(json.dumps({'old_frames_preserved':len(old['frames']),'new_frames':10,'errors':errors},indent=2)+'\n')
    if errors:raise SystemExit(str(errors))

def props_only_v6(publish_live=False):
    global OUT
    OUT=ART/'v6/staging';OUT.mkdir(parents=True,exist_ok=True);sync_provenance_v5(OUT)
    for p in LIVE.iterdir():
        if p.suffix in ['.png','.json'] and not (p.name=='prompts.json' and (OUT/p.name).exists()):shutil.copy2(p,OUT/p.name)
    load_baseline_props_v6();build_gold_props_v6();pack();validate();validate_props_v6();contact();props_review_v6()
    if publish_live:publish()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--validate-only',action='store_true');parser.add_argument('--publish',action='store_true');parser.add_argument('--publish-staged',action='store_true');parser.add_argument('--robots-only',action='store_true');parser.add_argument('--art-only',action='store_true');parser.add_argument('--props-only',action='store_true');args=parser.parse_args()
    if args.props_only:props_only_v6(args.publish)
    elif args.art_only:art_only_v5(args.publish)
    elif args.robots_only:robots_only(args.publish)
    elif args.validate_only:
        OUT=LIVE;validate()
    elif args.publish_staged:validate();publish()
    else:
        build();pack();contact();mock();v3_reviews();validate()
        if args.publish:publish()


