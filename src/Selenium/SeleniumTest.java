package Selenium;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.annotations.Test;

public class SeleniumTest {
	@Test

	public static void main(String[] args) {
		System.setProperty("webdriver.chrome.driver", "C:\\Users\\sreyyi\\Downloads\\chromedriver_win32\\chromedriver.exe");
		WebDriver driver =new ChromeDriver();
		
		driver.get("https://v310qa.v3locitydev.com/app");
		driver.manage().window().maximize();
		driver.findElement(By.id("username")).sendKeys("sandeep");
		driver.findElement(By.id("password")).sendKeys("123456");
		driver.findElement(By.xpath("//*[@title='Log In']")).click();
		WebDriverWait wait = new WebDriverWait(driver,3000);
		//driver.switchTo().frame("__gwt_historyFrame");
		//wait.until(ExpectedConditions.visibilityOf(driver.findElement(By.xpath("(//div//img[@class='gwt-Image'])[1]"))));
		driver.close();

	}

}
