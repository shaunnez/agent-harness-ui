// Exact squared Euclidean distance transform, lower envelope of 1D parabolas.
// Input: square uint8 raster (nonzero=land). Output: float32 distance in raster pixels.
#include <cmath>
#include <fstream>
#include <vector>
#include <string>
static void line(const std::vector<float>& f,std::vector<float>& d,int n){
 std::vector<int> v(n);std::vector<float> z(n+1);int k=0;v[0]=0;z[0]=-1e20f;z[1]=1e20f;
 for(int q=1;q<n;q++){float s;do{s=((f[q]+float(q)*q)-(f[v[k]]+float(v[k])*v[k]))/(2.f*(q-v[k]));if(s<=z[k])k--;else break;}while(k>=0);if(k<0){k=0;v[0]=q;z[0]=-1e20f;z[1]=1e20f;}else{k++;v[k]=q;z[k]=s;z[k+1]=1e20f;}}
 k=0;for(int q=0;q<n;q++){while(z[k+1]<q)k++;float x=q-v[k];d[q]=x*x+f[v[k]];}
}
int main(int argc,char**argv){if(argc!=4)return 1;int n=std::stoi(argv[1]);std::vector<unsigned char> mask(n*n);std::ifstream in(argv[2],std::ios::binary);in.read(reinterpret_cast<char*>(mask.data()),mask.size());if(!in)return 2;std::vector<float>a(n*n),f(n),d(n);for(int i=0;i<n*n;i++)a[i]=mask[i]?0.f:1e12f;
 for(int y=0;y<n;y++){for(int x=0;x<n;x++)f[x]=a[y*n+x];line(f,d,n);for(int x=0;x<n;x++)a[y*n+x]=d[x];}
 for(int x=0;x<n;x++){for(int y=0;y<n;y++)f[y]=a[y*n+x];line(f,d,n);for(int y=0;y<n;y++)a[y*n+x]=std::sqrt(d[y]);}
 std::ofstream out(argv[3],std::ios::binary);out.write(reinterpret_cast<const char*>(a.data()),a.size()*sizeof(float));return out?0:3;
}
