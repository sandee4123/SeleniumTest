package Selenium;



import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

public class TestNG1 {

	@DataProvider(name="data1")
	public Object[][] testng()
	{
		
		return new Object[][] {{"tes1","test2"},{"tes1","test2"}};
	}
	
}
