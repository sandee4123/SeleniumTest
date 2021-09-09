package Selenium;

import org.testng.SkipException;
import org.testng.annotations.Parameters;
import org.testng.annotations.Test;
import java.util.Scanner;

public class TestNG {

@Test(dataProvider="data1",dataProviderClass=TestNG1.class, groups="bvt")
	public void testng(String c, String b)
	{
		System.out.println(c+"b"+b);
	
	
	}
@Parameters({"browser"})
@Test
public void testng5() {
	System.out.println("print55");
	throw new SkipException("skip");
}
}
