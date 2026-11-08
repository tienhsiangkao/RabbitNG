# No GUI, native APIs, network, account access, or capture. Fabricated dimensions only.
import json, math, time
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Offline CPU-only six-table rectangle-packing check; requires NumPy/SciPy.')
parser.add_argument('--compact',action='store_true',help='Use the previously observed 652x528 replay minimum instead of898x700.')
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
W,H=3840,2112
compact=args.compact
label='compact' if compact else 'full'
# Six identical proportional tables plus full native utility windows.
sizes=[None]*6+[(424,600),(404,582),(324,192),((652,528) if compact else (898,700))]
N=len(sizes); pairs=[(i,j) for i in range(N) for j in range(i+1,N)]
# x[0:N], y[0:N], common table height, 4 separation binaries per pair.
hidx=2*N; size=2*N+1+4*len(pairs)
rows=[]; upper=[]
def add(values, bound): rows.append(values);upper.append(bound)
def dim(i,axis):
    if i<6:return {hidx:1.4 if axis==0 else 1.0},0
    return {},sizes[i][axis]
for i in range(N):
    for axis,limit in [(0,W),(1,H)]:
        co,constant=dim(i,axis);co={**co,axis*N+i:1};add(co,limit-constant)
for k,(i,j) in enumerate(pairs):
    start=2*N+1+4*k
    # A selected binary imposes a horizontal/vertical separation.
    gap=0 if i<6 and j<6 else 8
    for off,(a,b,axis,M) in enumerate([(i,j,0,W+8),(j,i,0,W+8),(i,j,1,H+8),(j,i,1,H+8)]):
        co,constant=dim(a,axis)
        co={**co,axis*N+a:1,axis*N+b:-1,start+off:M}
        add(co,M-constant-gap)
    add({start+o:-1 for o in range(4)},-1)
for i in range(5):add({i:1,i+1:-1},0)
A=lil_matrix((len(rows),size))
for r,values in enumerate(rows):
    for col,value in values.items():A[r,col]=value
lb=np.zeros(size);ub=np.full(size,np.inf)
lb[hidx]=704;ub[hidx]=math.sqrt((W*H-sum(w*h for w,h in sizes[6:]))/(6*1.4))
ub[2*N+1:]=1
objective=np.zeros(size);objective[hidx]=-1
integrality=np.zeros(size);integrality[2*N+1:]=1
start=time.time()
res=milp(objective,integrality=integrality,bounds=Bounds(lb,ub),constraints=LinearConstraint(A.tocsr(),-np.inf,np.array(upper)),options={'time_limit':45,'mip_rel_gap':0.00001})
result={'model':'Equal 7:5 tables, fixed utility rectangles, pairwise 8px utility separation, no dock or grid restriction','replayFormat':label,'message':res.message,'status':int(res.status),'seconds':time.time()-start,'heightUpperBound':float(-res.mip_dual_bound) if getattr(res,'mip_dual_bound',None) is not None else None}
if res.x is not None:
    h=res.x[hidx]
    result.update(height=h,width=h*1.4,gap=float(res.mip_gap),rects=[{'role':'table' if i<6 else ['challenge','notes','clock','replay'][i-6],'x':float(res.x[i]),'y':float(res.x[N+i]),'width':float(h*1.4 if i<6 else sizes[i][0]),'height':float(h if i<6 else sizes[i][1])} for i in range(N)])
if res.x is not None:
    for r in result['rects']:
        assert r['x']>=-1e-5 and r['y']>=-1e-5
        assert r['x']+r['width']<=W+1e-5 and r['y']+r['height']<=H+1e-5
    for i,a in enumerate(result['rects']):
        for b in result['rects'][i+1:]:
            gap=0 if a['role']=='table' and b['role']=='table' else 8
            assert (a['x']+a['width']+gap<=b['x']+1e-5 or b['x']+b['width']+gap<=a['x']+1e-5 or
                    a['y']+a['height']+gap<=b['y']+1e-5 or b['y']+b['height']+gap<=a['y']+1e-5)
    result['independentContainmentAndSeparationCheck']=True
print(json.dumps(result,indent=2))
args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
