package Selenium;

import org.testng.ITestListener;
import org.testng.ITestResult;

public class ListenerClass implements ITestListener {
	
public void onTestStart(ITestResult result)
{
	System.out.println("teststarrt");
}
	
}
