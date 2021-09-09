package Selenium;

public class Mtring {

	
	public static void main(java.lang.String[] args) {
		// TODO Auto-generated method stub
		String s= "valuelabs";
		char[] c= s.toCharArray();
		System.out.println(c.length);
		String r="";
		int p=1;
		for (int i=0;i<=c.length-1;i++)
		{
			
				
		
			if(c[i]=='a')
			{
				switch(p)
				{
				case 1:
					r=r+'1';
					break;
				case 2:
					r=r+'2';
					break;
				}
				
				p++;
			
		}
			else
			{
				r=r+c[i];
				
			}
			
		}
		System.out.println(r);
		String mo= "hello";
		String mb="java";
		int l=mo.length()+mb.length();
		System.out.println(l);
		String bo=mo.replace('h', 'H');
		String bm=mb.replace('j', 'J');
		System.out.println(bo+" "+bm);
		int a1[]= {1,2,9,4,5,6};
		int lp=a1.length;
		System.out.println(lp);
		
		for (int b:a1)
		{
		System.out.print(b);
		}
		for(int mi=0;mi<lp;mi++)
		{
			for (int jk=0;jk<=mi;jk++)
			{
				if (a1[mi]>a1[jk])
				{
					int temp = a1[mi];
				a1[mi]=a1[jk];
				a1[jk]=temp;
				}
			}
		}
		System.out.println("");
		for (int pl:a1)
		{
			
		System.out.print(pl);
		}
		
		String jl="acbdreps";
		System.out.println(jl);
		char[] cp=jl.toCharArray();
		int v=cp.length;
		
		for(int mi=0;mi<v;mi++)
		{
			for (int jk=0;jk<=mi;jk++)
			{
				if (cp[mi]>cp[jk])
				{
					char temp = cp[mi];
				cp[mi]=cp[jk];
				cp[jk]=temp;
				}
			}
		}
		for (char pk:cp)
		{
			
		System.out.print(pk);
		}
		StringBuilder am= new StringBuilder();
		 am.append("porn").insert(1, "c");
		 System.out.println(am);
		

	}

}
