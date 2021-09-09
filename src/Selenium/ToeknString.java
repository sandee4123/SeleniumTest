package Selenium;

public class ToeknString {

	public static void main(String[] args) {
		String a=" abc gfds hgjhjh \"ou\" \"out\"";
		System.out.println(a);
		char[] lpm= {'0', '4'};
		String[] bv= a.split("\"");
		String m=String.valueOf(lpm);
		System.out.println(m);
		String pl="valuelabs";
		String m1=pl.replaceFirst("a", "1");
		char[] lpm1= pl.toCharArray();
		
		
		System.out.println(m1);
	
	}
}