package Selenium;

import java.io.File;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Set;

import org.openqa.selenium.Alert;
import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.Keys;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.NoSuchWindowException;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.interactions.Action;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.remote.server.handler.SwitchToWindow;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.Assert;
import org.testng.annotations.Test;
import org.testng.asserts.SoftAssert;

class TestN
{
	int c=30;
	public static void testng()
	{
		
	}
}
class TestN2 extends TestN{
	public static void testn3() {
		testng();
		
		TestN a= new TestN();
		a.testng();
		int b=a.c;
		
	}
}
public class Amazon {
	

	public static void main(String[] args) throws InterruptedException {
		System.setProperty("webdriver.chrome.driver", "C:\\Users\\sreyyi\\Downloads\\chromedriver_win32\\chromedriver.exe");
		WebDriver driver =new ChromeDriver();
		
		/*driver.get("https://amazon.in");
		driver.manage().window().maximize();
		WebElement element1 = driver.findElement(By.xpath("//a[@id='nav-link-accountList']"));
		WebDriverWait wait = new WebDriverWait(driver,3000);		
		wait.until(ExpectedConditions.visibilityOf(element1));
		Actions action = new Actions(driver);
		action.moveToElement(element1).perform();
		try {
		driver.findElement(By.linkText("Your pOrders")).click();
		}
		catch(NoSuchElementException e) {
			System.out.println("print no such elemet");	
		}
		finally {
			System.out.println("whatever bro");
		}
		//Select s=new Select(element1);
		WebElement s1=driver.findElement(By.linkText("Your Orders"));
		Thread.sleep(300);
		String s3= Keys.chord(Keys.COMMAND,Keys.RETURN);
		s1.sendKeys(s3);
		Thread.sleep(300);*/
		driver.navigate().to("https://hide.me/en/proxy");
		Thread.sleep(300);
		driver.findElement(By.xpath("//input[@placeholder='Enter web address']")).sendKeys("http://seleniumpractise.blogspot.com/2017/07/multiple-window-examples.html"+Keys.RETURN);
		
		Thread.sleep(300);
		String parent =driver.getWindowHandle();
		driver.findElement(By.xpath("(//a[@name='link1'])[1]")).click();
		//driver.switchTo().window(parent);
		driver.findElement(By.xpath("(//a[@name='link1'])[2]")).click();
		//driver.switchTo().window(parent);
		Set<String> windowhandles = driver.getWindowHandles();
		int size=windowhandles.size();
		/*for(String child:windowhandles)
		{
			driver.switchTo().window(child);
		 if(!parent.equals(child))
		 {
			 String a=driver.getTitle();
			
			 driver.close();
			 System.out.println("closed" +a);
		 }
		}
		*/
		ArrayList<String> tab = new ArrayList<String>(windowhandles);
		driver.switchTo().window(tab.get(2));
		System.out.println(driver.getTitle());
		driver.close();
		try
		{
		driver.switchTo().window(tab.get(2));
		}
		catch(NoSuchWindowException e) {
			System.out.println("Google is closed bro");
		}
		driver.quit();
		Iterator a=tab.iterator();
	while(a.hasNext())
	{
		System.out.println(a.next());
	}
		Assert.assertEquals(false, false);
		SoftAssert soft = new SoftAssert();
		soft.assertEquals(false, false, "message");
		JavascriptExecutor js = (JavascriptExecutor)driver;
		js.executeScript("window.scrollBy(0,100)");
		File file = ((TakesScreenshot)driver).getScreenshotAs(OutputType.FILE);
Alert alert = null;
alert.accept();


TestN2.testn3();
		TestN b=new TestN2();
		b.testng();
		

	}

}

