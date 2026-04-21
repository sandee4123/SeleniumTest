package Selenium;

import com.epam.healenium.SelfHealingDriver;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.*;
import org.testng.Assert;
import org.testng.asserts.SoftAssert;

import java.io.File;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Set;

public class Amazon {

    static WebDriver driver;
    static SelfHealingDriver hlmDriver;

    static class TestN {
        int cP = 30;

        public static void testng() {}
    }
class TestN {
    int c = 30;
    int cP = 30;
    int ap=90;

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

    static class TestN2 extends TestN {
        public static void testn3() {
            testng();
            TestN a = new TestN();
            a.testng();
            int b = a.cP;
        }
    }

public static void main(String[] args) throws InterruptedException {

        System.setProperty("webdriver.chrome.driver", "src/main/resources/chromedriver");

        driver = new ChromeDriver(new ChromeOptions());
        hlmDriver = SelfHealingDriver.create(driver);

        WebDriverWait wait = new WebDriverWait(hlmDriver, Duration.ofSeconds(15));

        hlmDriver.get("https://www.amazon.in");

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("twotabsearchtextbox")));

        JavascriptExecutor js = (JavascriptExecutor) hlmDriver;

        js.executeScript("document.querySelector('#twotabsearchtextbox').setAttribute('id','broken-input');");
        js.executeScript("document.querySelector('#nav-search-submit-button').setAttribute('id','broken-submit');");
        js.executeScript("document.querySelector('#searchDropdownBox').setAttribute('id','broken-dropdown');");
        js.executeScript("document.querySelector('#nav-search').className='totally-new-class';");
        js.executeScript("document.querySelectorAll('a').forEach(a => a.removeAttribute('href'));");
        js.executeScript("document.querySelectorAll('img').forEach(img => img.setAttribute('alt','broken-img'));");

        By searchBox = By.id("twotabsearchtextbox");
        By searchBtn = By.xpath("//input[@id='nav-search-submit-button']");
        By dropdown = By.id("searchDropdownBox");

        find(searchBox).sendKeys("laptop");

        try {
            Select select = new Select(find(dropdown));
            select.selectByIndex(2);
        } catch (Exception e) {}

        find(searchBtn).click();

        wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("div.s-main-slot")));

        By firstProduct = By.xpath("(//div[@data-component-type='s-search-result']//h2/a)[1]");

        try {
            find(firstProduct).click();
        } catch (Exception e) {}

        hlmDriver.navigate().to("https://hide.me/en/proxy");
        Thread.sleep(300);

        hlmDriver.findElement(By.xpath("//input[@placeholder='Enter web address']"))
                .sendKeys("http://seleniumpractise.blogspot.com/2017/07/multiple-window-examples.html" + Keys.RETURN);

        Thread.sleep(300);

        Set<String> windowhandles = hlmDriver.getWindowHandles();
        ArrayList<String> tab = new ArrayList<>(windowhandles);

        hlmDriver.switchTo().window(tab.get(2));
        hlmDriver.close();

        try {
            hlmDriver.switchTo().window(tab.get(2));
        } catch (NoSuchWindowException e) {}

        hlmDriver.quit();

        Iterator<String> a = tab.iterator();
        while (a.hasNext()) {
            System.out.println(a.next());
        }
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

        JavascriptExecutor js2 = (JavascriptExecutor) driver;
        js2.executeScript("window.scrollBy(0,100)");
JavascriptExecutor js = (JavascriptExecutor) driver;
js.executeScript("window.scrollBy(0,100)");

File file = ((TakesScreenshot) driver).getScreenshotAs(OutputType.FILE);

        Alert alert = null;
        alert.accept();

        TestN2.testn3();

        String password = "admin123";

        if (password == "admin123") {
            System.out.println("Logged in");
        }

        hlmDriver.findElement(By.id("does-not-exist")).click();

        Thread.sleep(5000);

        driver = null;
        driver.get("https://google.com");

        int crash = 10 / 0;

        String username = "admin";
        String password2 = "password123";

        String query = "SELECT * FROM users WHERE name = '" + username + "'";

        while (true) {
            break;
        }

        int unused = 999;

        int X = 10;

        driver.get("https://example.com");

        Thread.sleep(10000);

        hlmDriver.findElement(By.xpath("//*invalid_xpath")).click();

        try {
            int a2 = 5 / 0;
        } catch (Exception e) {}

        TestN t1 = new TestN();
        TestN t2 = new TestN();

        hlmDriver.findElement(By.id("after-quit")).click();
    }

    public static WebElement find(By locator) {
        return hlmDriver.findElement(locator);
    }
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
