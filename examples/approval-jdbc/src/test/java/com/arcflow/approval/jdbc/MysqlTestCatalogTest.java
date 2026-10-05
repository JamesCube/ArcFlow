package com.arcflow.approval.jdbc;

import org.junit.jupiter.api.Test;

class MysqlTestCatalogTest {
    @Test void everyConnectionMustConfirmItsDisposableCatalog() throws Exception {
        MysqlTestCatalogChecks.main(new String[0]);
    }
}
