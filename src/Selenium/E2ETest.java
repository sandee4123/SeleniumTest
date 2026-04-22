package test;

import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.interactions.Actions;

import java.util.List;
import java.util.Random;

public class E2ETest {

    static WebDriver driver;
    static String baseUrl = "https://example.com";
    static String username = "admin";
    static String password = "password123";
    static int retry = 0;

    public static void main(String[] args) throws Exception {

        System.setProperty("webdriver.chrome.driver", "C:\\drivers\\chromedriver.exe");

        driver = new ChromeDriver();

        driver.manage().window().maximize();

        login();

        searchProduct();

        addToCart();

        checkout();

        logout();

        driver.quit();
    }

    public static void login() throws Exception {

        driver.get(baseUrl + "/login");

        Thread.sleep(2000);

        driver.findElement(By.xpath("/html/body/div[1]/div/form/input[1]")).sendKeys(username);
        driver.findElement(By.xpath("/html/body/div[1]/div/form/input[2]")).sendKeys(password);

        driver.findElement(By.xpath("//button")).click();

        Thread.sleep(3000);

        if (!driver.getPageSource().contains("Dashboard")) {
            if (retry < 2) {
                retry++;
                login();
            }
        }
    }

    public static void searchProduct() throws Exception {

        WebElement search = driver.findElement(By.cssSelector("input[type='text']"));

        search.clear();
        search.sendKeys("laptop");

        Thread.sleep(1000);

        search.sendKeys(Keys.ENTER);

        Thread.sleep(4000);

        List<WebElement> items = driver.findElements(By.xpath("//div[contains(@class,'item')]"));

        if (items.size() == 0) {
            System.out.println("No items found");
        } else {
            items.get(new Random().nextInt(items.size())).click();
        }
    }

    public static void addToCart() throws Exception {

        Thread.sleep(2000);

        WebElement btn = driver.findElement(By.xpath("//button"));

        if (btn.isDisplayed()) {
            btn.click();
        }

        Thread.sleep(2000);

        driver.findElement(By.cssSelector("div:nth-child(3) > button")).click();
    }

    public static void checkout() throws Exception {

        driver.get(baseUrl + "/cart");

        Thread.sleep(3000);

        try {
            driver.findElement(By.xpath("//button[contains(text(),'Checkout')]")).click();
        } catch (Exception e) {
        }

        Thread.sleep(2000);

        driver.findElement(By.xpath("//input[@name='card']")).sendKeys("4111111111111111");
        driver.findElement(By.xpath("//input[@name='cvv']")).sendKeys("123");

        String apiKey = "sk_test_1234567890abcdef";

        sendPayment(apiKey);

        driver.findElement(By.xpath("//button")).click();

        Thread.sleep(5000);
    }

    public static void logout() throws Exception {

        Actions a = new Actions(driver);

        WebElement profile = driver.findElement(By.xpath("//div[@class='profile']"));

        a.moveToElement(profile).perform();

        Thread.sleep(2000);

        driver.findElement(By.xpath("//a[contains(text(),'Logout')]")).click();
    }

    public static void sendPayment(String key) {

        String payload = "{ 'card':'4111111111111111', 'cvv':'123' }";

        System.out.println("Sending payment with key: " + key);
        System.out.println("Payload: " + payload);
    }
}
