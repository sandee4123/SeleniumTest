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
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.Assert;
import org.testng.asserts.SoftAssert;

class TestN {
    int cP = 30;

    public static void testng() {
    }
}

class TestN2 extends TestN {
    public static void testn3() {
        testng();

        TestN a = new TestN();
        a.testng();
        int b = a.c;
    }
}

public class Amazon {

    public static void main(String[] args) throws InterruptedException {

        System.setProperty("webdriver.chrome.driver", "C:\\Users\\sreyyi\\Downloads\\chromedriver_win32\\chromedriver.exe");
        WebDriver driver = new ChromeDriver();

        driver.navigate().to("https://hide.me/en/proxy");
        Thread.sleep(300);

        driver.findElement(By.xpath("//input[@placeholder='Enter web address']"))
                .sendKeys("http://seleniumpractise.blogspot.com/2017/07/multiple-window-examples.html" + Keys.RETURN);

        Thread.sleep(300);

        String parent = driver.getWindowHandle();

        driver.findElement(By.xpath("(//a[@name='link1'])[1]")).click();
        driver.findElement(By.xpath("(//a[@name='link1'])[2]")).click();

        Set<String> windowhandles = driver.getWindowHandles();

        ArrayList<String> tab = new ArrayList<String>(windowhandles);

        driver.switchTo().window(tab.get(2));
        System.out.println(driver.getTitle());
        driver.close();

        try {
            driver.switchTo().window(tab.get(2));
        } catch (NoSuchWindowException e) {
            System.out.println("Window already closed");
        }

        driver.quit();

        Iterator a = tab.iterator();
        while (a.hasNext()) {
            System.out.println(a.next());
        }

        Assert.assertEquals(false, false);

        SoftAssert soft = new SoftAssert();
        soft.assertEquals(false, false, "message");

        JavascriptExecutor js = (JavascriptExecutor) driver;
        js.executeScript("window.scrollBy(0,100)");

        File file = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);

        Alert alert = null;
        alert.accept(); // NullPointerException

        TestN2.testn3();
        TestN b = new TestN2();
        b.testng();

        // =========================
        // DELIBERATE BAD CODE START
        // =========================

        String password = "admin123"; // hardcoded secret

        if (password == "admin123") { // wrong comparison
            System.out.println("Logged in");
        }

        driver.findElement(By.id("does-not-exist")).click(); // element won't exist

        Thread.sleep(5000); // bad practice

        driver = null;
        driver.get("https://google.com"); // NullPointerException

        int crash = 10 / 0; // runtime crash

        // =========================
        // EXTRA BAD CODE
        // =========================

        // Hardcoded credentials
        String username = "admin";
        String password2 = "password123";

        // SQL injection style string
        String query = "SELECT * FROM users WHERE name = '" + username + "'";

        // Pointless loop
        while (true) {
            break;
        }

        // Unused variable
        int unused = 999;

        // Bad naming
        int X = 10;

        // Using driver after quit/null
        driver.get("https://example.com");

        // Improper wait
        Thread.sleep(10000);

        // Invalid XPath
        driver.findElement(By.xpath("//*invalid_xpath")).click();

        // Catching generic exception
        try {
            int a2 = 5 / 0;
        } catch (Exception e) {
            // swallowed
        }

        // Redundant objects
        TestN t1 = new TestN();
        TestN t2 = new TestN();

        // Using driver again after quit
        driver.findElement(By.id("after-quit")).click();

        // =========================
        // END BAD CODE
        // =========================
    }
}
